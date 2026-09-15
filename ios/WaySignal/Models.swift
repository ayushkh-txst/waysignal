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
    let isMine: Bool?; let observation: String?; let observedAt: String?
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
    let responderId: String?; let assignedAt: String?; let enRouteAt: String?; let resolvedAt: String?
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

struct LocalConditions: Decodable {
    let observedAt: String; let source: String; let temperatureC: Double?
    let precipitationNext6hMm: Double; let precipitationProbabilityMax6h: Double?
    let riverDischargeM3s: Double?; let riverTrendPercent: Double?
    let prototypeRiskScore: Int; let prototypeRiskLevel: String
    enum CodingKeys: String, CodingKey {
        case observedAt = "observed_at", source, temperatureC = "temperature_c"
        case precipitationNext6hMm = "precipitation_next_6h_mm"
        case precipitationProbabilityMax6h = "precipitation_probability_max_6h"
        case riverDischargeM3s = "river_discharge_m3s", riverTrendPercent = "river_trend_percent"
        case prototypeRiskScore = "prototype_risk_score", prototypeRiskLevel = "prototype_risk_level"
    }
}
struct NearbyFacility: Decodable, Identifiable {
    let id: String; let name: String; let kind: String; let latitude: Double; let longitude: Double
    var coordinate: Coordinate { .init(latitude: latitude, longitude: longitude) }
    var icon: String { kind == "hospital" ? "cross.case.fill" : kind == "school" ? "graduationcap.fill" : "building.2.fill" }
}
struct PlaceLabel: Decodable { let primary: String; let secondary: String; let source: String }
struct NearbyPlaces: Decodable {
    let location: PlaceLabel; let facilities: [NearbyFacility]; let facilitiesStatus: String
    let facilitiesSource: String; let notice: String; let retrievedAt: String
}
struct ReviewEvent: Decodable, Identifiable {
    let id: String; let decision: String; let note: String; let source: String; let createdAt: String
}
struct ConversationMessage: Identifiable {
    let id = UUID(); let role: String; let text: String; var response: GuideResponse? = nil
}
struct ChatHistory: Encodable { let role: String; let text: String }
struct ChatInput: Encodable {
    let message: String; let route: RouteInput?; let routeGeometry: [Coordinate]?
    let location: Coordinate?; let requestId: String?; let history: [ChatHistory]
}
struct OperationsReport: Decodable {
    struct Summary: Decodable { let total: Int; let active: Int; let resolved: Int; let cancelled: Int; let peopleInActive: Int; let peopleInResolved: Int }
    struct Count: Decodable, Identifiable { let key: String; let count: Int; var id: String { key } }
    let generatedAt: String; let summary: Summary; let statuses: [Count]; let incidentTypes: [Count]
}
