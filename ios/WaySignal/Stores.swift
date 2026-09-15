import Foundation
import Combine
import CoreLocation

@MainActor final class SessionStore: ObservableObject {
    @Published var account: LoginResponse?
    @Published var server = UserDefaults.standard.string(forKey: "waysignal.server") ?? "http://localhost:8000"
    @Published var error: String?; @Published var busy = false
    var client: APIClient? {
        guard let url = URL(string: server), let account else { return nil }
        return APIClient(baseURL: url, token: account.accessToken)
    }
    init() {
        if let data = SessionVault.read(host: server) { account = try? Wire.decode(LoginResponse.self, from: data) }
    }
    func signIn(email: String, password: String) async {
        guard !busy else { return }; busy = true; error = nil
        defer { busy = false }
        server = server.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: server), ["http", "https"].contains(url.scheme ?? ""), url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { error = "Enter the server origin, for example https://your-server.example."; return }
        #if !DEBUG
        guard url.scheme == "https" else { error = "Release builds require an HTTPS server."; return }
        #endif
        do {
            let response: LoginResponse = try await APIClient(baseURL: url).request("auth/login", method: "POST",
                body: Wire.encode(["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "password": password]))
            try SessionVault.save(Wire.encode(response), host: server)
            UserDefaults.standard.set(server, forKey: "waysignal.server")
            account = response
        } catch { self.error = error.localizedDescription }
    }
    func signOut() { SessionVault.clear(host: server); account = nil; error = nil }
}
@MainActor final class JourneyStore: ObservableObject {
    @Published var origin: Coordinate? { didSet { assessment = nil } }
    @Published var destination: Coordinate? { didSet { assessment = nil } }
    @Published var destinationName = "Selected destination" { didSet { assessment = nil } }
    @Published var assessment: RouteAssessment?; @Published var error: String?; @Published var busy = false
    private let service: any RouteServing
    init(service: any RouteServing) { self.service = service }
    var input: RouteInput? {
        guard let origin, let destination else { return nil }
        return .init(origin: origin, destination: destination, destinationName: destinationName)
    }
    func assess() async {
        guard let input, !busy else { return }; busy = true; error = nil; assessment = nil
        defer { busy = false }
        do { assessment = try await service.assess(input) } catch { self.error = error.localizedDescription }
    }
}
@MainActor final class CommunityStore: ObservableObject {
    @Published var reports: [CommunityReport] = []; @Published var error: String?; @Published var busy = false
    @Published var loadedAt: Date?
    let service: any CommunityServing
    init(service: any CommunityServing) { self.service = service }
    func load() async {
        guard !busy else { return }; busy = true; error = nil
        defer { busy = false }
        do { reports = try await service.reports(); loadedAt = Date() } catch { self.error = error.localizedDescription }
    }
}
@MainActor final class AssistanceStore: ObservableObject {
    @Published var requests: [AssistanceRequest] = []; @Published var error: String?; @Published var busy = false
    let service: any AssistanceServing
    init(service: any AssistanceServing) { self.service = service }
    func load() async {
        guard !busy else { return }; busy = true; error = nil
        defer { busy = false }
        do { requests = try await service.requests() } catch { self.error = error.localizedDescription }
    }
    func cancel(_ id: String) async {
        guard !busy else { return }; busy = true; error = nil
        do {
            let changed = try await service.cancel(id)
            requests = requests.map { $0.id == id ? changed : $0 }
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}
@MainActor final class GuideStore: ObservableObject {
    @Published var response: GuideResponse?; @Published var error: String?; @Published var busy = false
    let service: any GuideServing
    init(service: any GuideServing) { self.service = service }
    func ask(_ input: GuideInput) async {
        guard !busy else { return }; busy = true; error = nil; response = nil
        defer { busy = false }
        do { response = try await service.summarize(input) } catch { self.error = error.localizedDescription }
    }
}

@MainActor final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var coordinate: Coordinate?; @Published var error: String?
    private let manager = CLLocationManager()
    override init() { super.init(); manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters }
    func request() {
        error = nil
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: manager.requestLocation()
        default: error = "Location is unavailable. Enter coordinates manually or enable access in Settings."
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { manager.requestLocation() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0, abs(last.timestamp.timeIntervalSinceNow) < 60 else {
            error = "A recent location was not available. Enter coordinates manually."; return
        }
        coordinate = .init(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { self.error = error.localizedDescription }
}

@MainActor final class ScenarioStore: ObservableObject {
    @Published var info: ScenarioInfo?; @Published var error: String?
    var enabled: Bool { info?.enabled == true }
    let client: APIClient
    init(client: APIClient) { self.client = client }
    func load() async {
        error = nil
        do { info = try await client.request("mobile/scenario") }
        catch { self.error = error.localizedDescription }
    }
    func useStart(_ journey: JourneyStore) {
        guard let info, info.enabled else { return }
        journey.origin = info.origin; journey.destination = info.destination
        journey.destinationName = info.destinationName ?? "Demo destination"
    }
}
