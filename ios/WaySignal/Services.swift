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
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = path == "mobile/assistant" ? 75 : 35
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(message: "The server did not return a response.") }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError(message: "Your session expired. Sign out and sign in again.") }
            let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let detail = value?["detail"] as? String
            throw APIError(message: detail ?? "Request failed (\(http.statusCode)). Check the fields and retry.")
        }
        return try Wire.decode(T.self, from: data)
    }
}

protocol CommunityServing {
    func reports() async throws -> [CommunityReport]
    func create(kind: String, coordinate: Coordinate, photo: String?, requestId: UUID, note: String) async throws -> SavedReport
}
struct CommunityService: CommunityServing {
    let client: APIClient
    func reports() async throws -> [CommunityReport] { try await client.request("mobile/community") }
    func create(kind: String, coordinate: Coordinate, photo: String?, requestId: UUID, note: String) async throws -> SavedReport {
        struct Payload: Encodable {
            let clientRequestId: String; let kind: String; let latitude: Double
            let longitude: Double; let photoBase64: String?; let note: String
        }
        return try await client.request("mobile/community", method: "POST", body: Wire.encode(Payload(
            clientRequestId: requestId.uuidString, kind: kind, latitude: coordinate.latitude,
            longitude: coordinate.longitude, photoBase64: photo, note: note)))
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

protocol ContextServing {
    func conditions(at coordinate: Coordinate) async throws -> LocalConditions
    func places(at coordinate: Coordinate) async throws -> NearbyPlaces
}
struct ContextService: ContextServing {
    let client: APIClient
    func conditions(at coordinate: Coordinate) async throws -> LocalConditions {
        try await client.query("safety/context", values: ["latitude": String(coordinate.latitude), "longitude": String(coordinate.longitude)], decoder: JSONDecoder())
    }
    func places(at coordinate: Coordinate) async throws -> NearbyPlaces {
        try await client.query("citizen-map/places", values: ["latitude": String(coordinate.latitude), "longitude": String(coordinate.longitude)])
    }
}
extension APIClient {
    func query<T: Decodable>(_ path: String, values: [String: String], decoder: JSONDecoder? = nil) async throws -> T {
        guard var parts = URLComponents(url: baseURL.appendingPathComponent("api/v1/" + path), resolvingAgainstBaseURL: false) else { throw APIError(message: "Invalid server address.") }
        parts.queryItems = values.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = parts.url else { throw APIError(message: "Invalid request.") }
        var request = URLRequest(url: url); request.timeoutInterval = 25
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw APIError(message: "Could not load this information. Check the connection and retry.") }
        if let decoder { return try decoder.decode(T.self, from: data) }
        return try Wire.decode(T.self, from: data)
    }
}
protocol ResponderServing {
    func incidents() async throws -> [AssistanceRequest]
    func update(_ request: AssistanceRequest, status: String, account: Account) async throws -> AssistanceRequest
    func review(_ report: CommunityReport, decision: String, note: String) async throws -> CommunityReport
    func resolve(_ id: String) async throws
    func reports() async throws -> OperationsReport
}
struct ResponderService: ResponderServing {
    let client: APIClient
    func incidents() async throws -> [AssistanceRequest] { try await client.request("emergencies") }
    func update(_ request: AssistanceRequest, status: String, account: Account) async throws -> AssistanceRequest {
        try await client.request("emergencies/" + request.id, method: "PATCH", body: Wire.encode([
            "status": status, "responder_id": request.responderId ?? account.id, "responder_name": request.responderName ?? account.name]))
    }
    func review(_ report: CommunityReport, decision: String, note: String) async throws -> CommunityReport {
        struct Payload: Encodable { let decision: String; let note: String; let expectedVersion: Int }
        return try await client.request("mobile/community/" + report.id + "/review", method: "POST", body: Wire.encode(Payload(decision: decision, note: note, expectedVersion: report.reviewVersion)))
    }
    func resolve(_ id: String) async throws { let _: SavedReport = try await client.request("hazards/" + id, method: "PATCH", body: Wire.encode(["status":"resolved"])) }
    func reports() async throws -> OperationsReport { try await client.request("reports") }
}
