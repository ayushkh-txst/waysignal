import Foundation
import Combine
import CoreLocation

@MainActor final class SessionStore: ObservableObject {
    @Published var account: LoginResponse?
    @Published var server = UserDefaults.standard.string(forKey: "waysignal.server") ?? "http://localhost:8000"
    @Published var error: String?; @Published var busy = false
    @Published var rememberSignIn = UserDefaults.standard.bool(forKey: "waysignal.rememberSignIn")
    var client: APIClient? {
        guard let url = URL(string: server), let account else { return nil }
        return APIClient(baseURL: url, token: account.accessToken)
    }
    init() {
        if rememberSignIn {
            if let data = SessionVault.read(host: server) { account = try? Wire.decode(LoginResponse.self, from: data) }
        } else {
            // Previous builds restored sessions without an explicit opt-in.
            SessionVault.clear(host: server)
        }
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
            if rememberSignIn {
                try SessionVault.save(Wire.encode(response), host: server)
            } else {
                SessionVault.clear(host: server)
            }
            UserDefaults.standard.set(rememberSignIn, forKey: "waysignal.rememberSignIn")
            UserDefaults.standard.set(server, forKey: "waysignal.server")
            account = response
        } catch { self.error = error.localizedDescription }
    }
    func signOut() { SessionVault.clear(host: server); account = nil; error = nil }
}
@MainActor final class JourneyStore: ObservableObject {
    @Published var origin: Coordinate? { didSet { if origin != oldValue { assessment = nil } } }
    @Published var destination: Coordinate? { didSet { if destination != oldValue { assessment = nil; shelter = nil } } }
    @Published var destinationName = "Selected destination" { didSet { if destinationName != oldValue { assessment = nil } } }
    @Published var assessment: RouteAssessment?; @Published var error: String?; @Published var busy = false
    @Published var shelter: ShelterSite?
    private let service: any RouteServing
    init(service: any RouteServing) { self.service = service }
    var input: RouteInput? {
        guard let origin, let destination else { return nil }
        return .init(origin: origin, destination: destination, destinationName: destinationName)
    }
    func assess() async {
        guard let input, !busy else { return }; busy = true; error = nil; assessment = nil; shelter = nil
        defer { busy = false }
        do {
            let result = try await service.assess(input)
            guard origin == input.origin, destination == input.destination else { return }
            assessment = result
        } catch { self.error = error.localizedDescription }
    }
    func routeToShelter(_ shelterId: String? = nil) async {
        guard let origin, !busy else { error = "Set your starting point first."; return }
        busy = true; error = nil; assessment = nil; shelter = nil
        defer { busy = false }
        do {
            let result = try await service.shelterRoute(origin, shelterId: shelterId)
            guard self.origin == origin else { return }
            destination = result.shelter.coordinate; destinationName = result.shelter.name
            shelter = result.shelter; assessment = result.assessment
        } catch { self.error = error.localizedDescription }
    }
    func refreshRoute() async {
        if shelter != nil { await routeToShelter() } else if assessment != nil { await assess() }
    }
}
@MainActor final class CommunityStore: ObservableObject {
    @Published var reports: [CommunityReport] = []; @Published var error: String?; @Published var busy = false
    @Published var loadedAt: Date?
    @Published var mapState: MapSnapshot?; @Published var mapError: String?
    let service: any CommunityServing
    init(service: any CommunityServing) { self.service = service }
    func load() async {
        guard !busy else { return }; busy = true; error = nil
        defer { busy = false }
        do { reports = try await service.reports(); loadedAt = Date() } catch { self.error = error.localizedDescription }
        do { mapState = try await service.mapState(); mapError = nil } catch { mapError = error.localizedDescription }
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
    @Published var updatedAt: Date?
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
        else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { error = "Location access is off. Enable it in Settings or choose a starting point." }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0, abs(last.timestamp.timeIntervalSinceNow) < 60 else {
            error = "A recent location was not available. Enter coordinates manually."; return
        }
        coordinate = .init(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude)
        updatedAt = Date()
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
        journey.destinationName = info.destinationName ?? "Destination"
    }
}

@MainActor final class AppNavigation: ObservableObject {
    @Published var tab = "home"
    @Published var guidePrompt: String?
    func ask(_ question: String) { guidePrompt = question; tab = "guide" }
}
@MainActor final class ContextStore: ObservableObject {
    @Published var conditions: LocalConditions?; @Published var places: NearbyPlaces?
    @Published var weatherError: String?; @Published var placesError: String?; @Published var busy = false
    let service: any ContextServing
    init(service: any ContextServing) { self.service = service }
    func load(_ coordinate: Coordinate, includePlaces: Bool = true) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        weatherError = nil; placesError = nil
        do { conditions = try await service.conditions(at: coordinate) } catch { weatherError = error.localizedDescription }
        if includePlaces { do { places = try await service.places(at: coordinate) } catch { placesError = error.localizedDescription } }
    }
}
@MainActor final class OperationsStore: ObservableObject {
    @Published var incidents: [AssistanceRequest] = []; @Published var report: OperationsReport?
    @Published var reportError: String?; @Published var reportBusy = false
    @Published var error: String?; @Published var busy = false
    let service: any ResponderServing
    init(service: any ResponderServing) { self.service = service }
    func load() async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do { incidents = try await service.incidents() } catch { self.error = error.localizedDescription }
    }
    func loadReports() async {
        guard !reportBusy else { return }; reportBusy = true; reportError = nil; defer { reportBusy = false }
        do { report = try await service.reports() } catch { reportError = error.localizedDescription }
    }
    func transition(_ request: AssistanceRequest, to status: String, account: Account) async {
        guard !busy else { return }; busy = true; error = nil
        do { let changed = try await service.update(request, status: status, account: account); incidents = incidents.map { $0.id == changed.id ? changed : $0 } } catch { self.error = error.localizedDescription }
        busy = false
    }
}
