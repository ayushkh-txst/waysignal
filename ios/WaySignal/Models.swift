import Foundation
import CoreLocation

struct Coordinate: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    var location: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
    static func parse(_ latitude: String, _ longitude: String) -> Coordinate? {
        guard let lat = Double(latitude), let lon = Double(longitude), lat.isFinite, lon.isFinite,
              (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
        return .init(latitude: lat, longitude: lon)
    }
}
struct Account: Codable { let id: String; let name: String; let email: String; let role: String }
struct LoginResponse: Codable { let user: Account; let accessToken: String; let expiresIn: Int }
struct CommunityReport: Decodable, Identifiable {
    let id: String; let kind: String; let label: String
    let latitude: Double; let longitude: Double; let accuracyM: Double?
    let status: String; let source: String; let reporterSource: String
    let createdAt: String; let updatedAt: String; let hasPhoto: Bool
    let reviewState: String; let reviewVersion: Int; let reviewNote: String
    var coordinate: Coordinate { .init(latitude: latitude, longitude: longitude) }
}
struct SavedReport: Decodable { let id: String }
struct RouteFinding: Decodable, Identifiable {
    let reportId: String; let label: String; let reviewState: String
    let distanceM: Double; let disposition: String; let reason: String
    var id: String { reportId + disposition }
}
struct RouteCandidate: Decodable, Identifiable {
    let id: String; let geometry: [[Double]]; let distanceM: Double; let durationS: Double
    let excluded: Bool; let findings: [RouteFinding]; let transportMode: String
    var coordinates: [CLLocationCoordinate2D] {
        geometry.compactMap { $0.count == 2 ? .init(latitude: $0[0], longitude: $0[1]) : nil }
    }
}
struct RouteAssessment: Decodable {
    let destinationName: String; let generatedAt: String; let candidates: [RouteCandidate]
    let selectedId: String?; let source: String; let notice: String
    var selected: RouteCandidate? { candidates.first { $0.id == selectedId } }
}
struct RouteInput: Encodable {
    let origin: Coordinate; let destination: Coordinate; let destinationName: String
}
struct AssistanceRequest: Decodable, Identifiable {
    let id: String; let citizenName: String; let emergencyType: String; let peopleCount: Int
    let latitude: Double; let longitude: Double; let status: String; let notes: String
    let responderName: String?; let createdAt: String; let updatedAt: String?; let isDemo: Bool
}
struct GuideSource: Decodable, Identifiable { let id: String; let kind: String; let status: String }
struct GuideResponse: Decodable {
    let mode: String; let text: String; let sources: [GuideSource]; let toolUsed: String; let notice: String
}
struct GuideInput: Encodable {
    let action: String; var route: RouteInput? = nil
    var routeGeometry: [Coordinate]? = nil; var requestId: String? = nil
}

enum Wire {
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.keyEncodingStrategy = .convertToSnakeCase
        return try encoder.encode(value)
    }
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(type, from: data)
    }
    static func date(_ text: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
        return parsed?.formatted(date: .abbreviated, time: .shortened) ?? text
    }
}

struct ScenarioInfo: Decodable {
    let enabled: Bool; let title: String; let notice: String
    let origin: Coordinate?; let destination: Coordinate?; let destinationName: String?
}
