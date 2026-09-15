import SwiftUI
import MapKit

struct ResponderRouteInput: Encodable {
    let origin: Coordinate?
    let originSource: String
}
struct ResponderRoute: Decodable {
    let requestId: String; let citizenName: String
    let origin: Coordinate; let destination: Coordinate; let originSource: String
    let locationUpdatedAt: String?; let assessment: RouteAssessment
}

/// Origins are explicit; the server resolves the destination from the request ID.
struct ResponderNavigationView: View {
    let initial: AssistanceRequest
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var operations: OperationsStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var scenario: ScenarioStore
    @StateObject private var gps = LocationProvider()
    @State private var camera: MapCameraPosition = .automatic
    @State private var result: ResponderRoute?
    @State private var busy = false; @State private var waitingForGPS = false
    @State private var error: String?; @State private var source = "device"
    @State private var latitude = ""; @State private var longitude = ""
    @State private var manual = false; @State private var pickPin = false
    @State private var initialRouteLoaded = false
    @State private var lastInput: ResponderRouteInput?
    @State private var refreshPending = false
    var request: AssistanceRequest { operations.incidents.first { $0.id == initial.id } ?? initial }
    var closed: Bool { ["resolved", "cancelled"].contains(request.status) }
    var originTitle: String {
        switch result?.originSource ?? source {
        case "response_base": return "Riverside response base"
        case "manual": return "Chosen starting point"
        default: return "Your location"
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Reach \(request.citizenName)").font(.title2.bold())
                Text("\(request.emergencyType.capitalized) · \(request.peopleCount) \(request.peopleCount == 1 ? "person" : "people")").foregroundStyle(.secondary)
                if result != nil || busy {
                    Label("From \(originTitle)", systemImage: "location.circle.fill").font(.subheadline.bold())
                }
                map
                if closed {
                    Label("This request is closed", systemImage: "checkmark.circle").font(.headline)
                } else {
                    locationControls
                }
                ErrorNotice(message: error ?? gps.error)
                if let result, !closed { routeDetails(result) }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Directions").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $pickPin) { ReportPinPicker(latitude: $latitude, longitude: $longitude) }
            .onAppear { frameMap() }
            .task(id: scenario.enabled) {
                #if targetEnvironment(simulator)
                // An explicitly named base provides the walkthrough origin without pretending it is GPS.
                if scenario.enabled, !initialRouteLoaded, !closed {
                    initialRouteLoaded = true
                    await load(origin: nil, source: "response_base")
                }
                #endif
            }
            .onChange(of: gps.updatedAt) { _, _ in
                guard waitingForGPS, let point = gps.coordinate else { return }
                waitingForGPS = false
                Task { await load(origin: point, source: "device") }
            }
            .onChange(of: gps.error) { _, value in if value != nil { waitingForGPS = false } }
            .onChange(of: request.coordinate) { _, _ in refreshDirections() }
            .onChange(of: closed) { _, value in if value { result = nil } }
            .onChange(of: hazardRevision) { old, new in
                if old != new { refreshDirections() }
            }
            .task(id: waitingForGPS) {
                guard waitingForGPS else { return }
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled, waitingForGPS else { return }
                waitingForGPS = false; gps.cancel(); error = "Location is taking too long. Retry or choose a starting point."
            }
            .onDisappear { waitingForGPS = false; gps.cancel() }
    }
    private var hazardRevision: String {
        community.reports.map { "\($0.id):\($0.status):\($0.reviewVersion):\($0.updatedAt)" }.sorted().joined(separator: "|")
    }
    private var map: some View {
        Map(position: $camera) {
            MapRiskLayer(snapshot: community.mapState)
            if let result, !closed {
                Marker(originTitle, systemImage: "location.fill", coordinate: result.origin.location).tint(SignalStyle.blue)
                if let route = result.assessment.selected {
                    MapPolyline(coordinates: route.coordinates).stroke(SignalStyle.blue, lineWidth: 6)
                }
            }
            Marker(result?.citizenName ?? request.citizenName, systemImage: "hand.raised.fill", coordinate: (result?.destination ?? request.coordinate).location).tint(.orange)
        }.frame(height: 310).clipShape(RoundedRectangle(cornerRadius: 20))
            .overlay(alignment: .topTrailing) { Button { frameMap() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right").padding(10).background(.regularMaterial, in: Circle()) }.padding(10).accessibilityLabel("Show entire route") }
    }
    private var locationControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            PrimaryButton(title: waitingForGPS ? "Finding your location…" : "Use my location", icon: "location.fill", busy: busy || waitingForGPS) {
                // Retain a clearly labelled base/manual route until a new GPS origin succeeds.
                error = nil; waitingForGPS = true; gps.request()
            }
            if scenario.enabled {
                Button { waitingForGPS = false; gps.cancel(); Task { await load(origin: nil, source: "response_base") } } label: {
                    Label("Use Riverside response base", systemImage: "building.2")
                }.buttonStyle(.bordered).disabled(busy)
            }
            DisclosureGroup("Choose a starting point", isExpanded: $manual) {
                VStack(alignment: .leading, spacing: 12) {
                    Button("Choose on map") { pickPin = true }.disabled(busy)
                    TextField("Latitude", text: $latitude).keyboardType(.numbersAndPunctuation)
                    TextField("Longitude", text: $longitude).keyboardType(.numbersAndPunctuation)
                    Button("Get directions from this point") {
                        guard let point = Coordinate.parse(latitude, longitude) else { return }
                        waitingForGPS = false; gps.cancel(); Task { await load(origin: point, source: "manual") }
                    }.disabled(busy || Coordinate.parse(latitude, longitude) == nil)
                }.textFieldStyle(.roundedBorder).padding(.top, 10)
            }
            if let lastInput {
                Button { Task { await load(origin: lastInput.origin, source: lastInput.originSource) } } label: {
                    Label("Refresh directions", systemImage: "arrow.clockwise")
                }.disabled(busy || waitingForGPS)
            }
        }
    }
    @ViewBuilder private func routeDetails(_ result: ResponderRoute) -> some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 12) {
                Label(originTitle, systemImage: "location.circle.fill")
                Label(result.citizenName, systemImage: "mappin.circle.fill")
                if let timestamp = result.locationUpdatedAt { Text("Request location updated \(Wire.date(timestamp))").font(.caption).foregroundStyle(.secondary) }
                if let route = result.assessment.selected {
                    HStack {
                        Label(String(format: "%.1f km", route.distanceM / 1000), systemImage: "arrow.triangle.turn.up.right.diamond")
                        Spacer()
                        Text("About \(max(1, Int(ceil(route.durationS / 60)))) min").bold()
                    }
                } else {
                    Label("No available route", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.headline)
                    Text("Reported hazards affect all returned routes. Check the reports or choose another starting point.")
                }
                Text("Assessed \(Wire.date(result.assessment.generatedAt))").font(.caption).foregroundStyle(.secondary)
            }
        }
        if let route = result.assessment.selected, let steps = route.steps, !steps.isEmpty {
            SignalCard {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Directions").font(.headline)
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top) { Text("\(index + 1).").bold(); Text(step.instruction); Spacer(); Text("\(Int(step.distanceM)) m").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
        }
        DisclosureGroup("Route sources & reported hazards") {
            VStack(alignment: .leading, spacing: 10) {
                Text(result.assessment.source).font(.subheadline.bold())
                Text(result.assessment.notice).font(.caption)
                ForEach(result.assessment.candidates) { route in
                    ForEach(route.findings) { finding in
                        Text("\(route.id): \(finding.label) · \(SignalCopy.recordID(finding.reportId))").font(.caption)
                    }
                }
            }.padding(.top, 8)
        }
    }
    private func refreshDirections() {
        guard lastInput != nil, !closed else { return }
        result = nil
        if busy { refreshPending = true; return }
        if let lastInput { Task { await load(origin: lastInput.origin, source: lastInput.originSource) } }
    }
    private func frameMap() {
        let points = (result?.assessment.selected?.coordinates ?? []) + [request.coordinate.location] + (result.map { [$0.origin.location] } ?? [])
        let lats = points.map(\.latitude), lons = points.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return }
        camera = .region(.init(center: .init(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: .init(latitudeDelta: max(0.008, (maxLat - minLat) * 1.45), longitudeDelta: max(0.008, (maxLon - minLon) * 1.45))))
    }
    private func load(origin: Coordinate?, source: String) async {
        guard !busy, let client = session.client else { return }
        guard !closed else { result = nil; return }
        busy = true; error = nil; gps.error = nil; result = nil; self.source = source
        lastInput = ResponderRouteInput(origin: origin, originSource: source)
        let destination = request.coordinate
        let revision = hazardRevision
        defer {
            busy = false
            if refreshPending { refreshPending = false; refreshDirections() }
        }
        do {
            let response: ResponderRoute = try await client.request("mobile/incidents/\(initial.id)/route", method: "POST",
                body: Wire.encode(ResponderRouteInput(origin: origin, originSource: source)))
            guard !Task.isCancelled, !closed else { return }
            guard !refreshPending, destination == request.coordinate, revision == hazardRevision else {
                refreshPending = true; return
            }
            result = response; frameMap()
        } catch { self.error = error.localizedDescription }
    }
}
