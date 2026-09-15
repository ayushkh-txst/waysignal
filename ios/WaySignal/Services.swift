import Foundation
import Security

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct APIClient {
    let baseURL: URL
    var token: String? = nil
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/" + path))
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = 35
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "The server did not return a response.") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError(message: "Your session expired. Sign out and sign in again.") }
            let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError(message: value?["detail"] as? String ?? "Request failed (\(http.statusCode)). Check the fields and retry.")
        }
        return try Wire.decode(T.self, from: data)
    }
}

protocol CommunityServing {
    func reports() async throws -> [CommunityReport]
    func create(kind: String, coordinate: Coordinate, photo: String?, requestId: UUID) async throws -> SavedReport
}
struct CommunityService: CommunityServing {
    let client: APIClient
    func reports() async throws -> [CommunityReport] { try await client.request("mobile/community") }
    func create(kind: String, coordinate: Coordinate, photo: String?, requestId: UUID) async throws -> SavedReport {
        struct Payload: Encodable {
            let clientRequestId: String; let kind: String; let latitude: Double
            let longitude: Double; let photoBase64: String?
        }
        return try await client.request("hazards", method: "POST", body: Wire.encode(Payload(
            clientRequestId: requestId.uuidString, kind: kind, latitude: coordinate.latitude,
            longitude: coordinate.longitude, photoBase64: photo)))
    }
}
protocol RouteServing { func assess(_ input: RouteInput) async throws -> RouteAssessment }
struct RouteService: RouteServing {
    let client: APIClient
    func assess(_ input: RouteInput) async throws -> RouteAssessment {
        try await client.request("mobile/routes/assess", method: "POST", body: Wire.encode(input))
    }
}
struct AssistanceInput: Encodable {
    let citizenId: String; let citizenName: String; let emergencyType: String
    let latitude: Double; let longitude: Double; let peopleCount: Int; let notes: String
}
protocol AssistanceServing {
    func requests() async throws -> [AssistanceRequest]
    func create(_ input: AssistanceInput) async throws -> AssistanceRequest
    func cancel(_ id: String) async throws -> AssistanceRequest
}
struct AssistanceService: AssistanceServing {
    let client: APIClient
    func requests() async throws -> [AssistanceRequest] { try await client.request("emergencies") }
    func create(_ input: AssistanceInput) async throws -> AssistanceRequest {
        try await client.request("emergencies", method: "POST", body: Wire.encode(input))
    }
    func cancel(_ id: String) async throws -> AssistanceRequest {
        try await client.request("emergencies/\(id)/cancel", method: "POST")
    }
}
protocol GuideServing { func summarize(_ input: GuideInput) async throws -> GuideResponse }
struct GuideService: GuideServing {
    let client: APIClient
    func summarize(_ input: GuideInput) async throws -> GuideResponse {
        try await client.request("mobile/guide", method: "POST", body: Wire.encode(input))
    }
}

enum SessionVault {
    private static func query(_ host: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.waysignal.session", kSecAttrAccount as String: host]
    }
    static func save(_ data: Data, host: String) throws {
        let item = query(host); SecItemDelete(item as CFDictionary)
        var insertion = item; insertion[kSecValueData as String] = data
        insertion[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { throw APIError(message: "Unable to store the sign-in securely.") }
    }
    static func read(host: String) -> Data? {
        var item = query(host); item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }
    static func clear(host: String) { SecItemDelete(query(host) as CFDictionary) }
}
