import SwiftUI
import MapKit

struct JourneyView: View {
    @EnvironmentObject private var scenario: ScenarioStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var location: LocationProvider
    @EnvironmentObject private var context: ContextStore
    @EnvironmentObject private var navigation: AppNavigation
    @State private var position: MapCameraPosition = .automatic
    @State private var showSearch = false; @State private var showRoutes = false
    @State private var showAlternatives = false
    @State private var showReport = false; @State private var satellite = false; @State private var showPlaces = true
    @State private var selectedReport: CommunityReport?
    var body: some View {
        Map(position: $position) {
            MapRiskLayer(snapshot: community.mapState)
            if let assessment = journey.assessment {
                if showAlternatives || journey.shelter == nil {
                    ForEach(assessment.candidates.filter { $0.id != assessment.selectedId }) { route in
                        MapPolyline(coordinates: route.coordinates).stroke(route.excluded ? Color.red.opacity(0.55) : Color.gray.opacity(0.6), lineWidth: 3)
                    }
                }
                if let selected = assessment.selected, !selected.excluded {
                    MapPolyline(coordinates: selected.coordinates).stroke(.white.opacity(0.95), lineWidth: 9)
                    MapPolyline(coordinates: selected.coordinates).stroke(journey.shelter == nil ? SignalStyle.blue : SignalStyle.shelterGreen, lineWidth: 6)
                }
            }
            ForEach((community.mapState?.shelters ?? []).filter { $0.available }) { site in
                Annotation(site.name, coordinate: site.coordinate.location) {
                    Button { Task { await journey.routeToShelter(site.id); showAlternatives = false; frameSelectedRoute() } } label: {
                        Image(systemName: "house.lodge.fill").foregroundStyle(.white).padding(10).background(.green, in: Circle())
                    }.accessibilityLabel("Open shelter: " + site.name)
                }
            }
            if let origin = journey.origin { Marker("Starting point", systemImage: "location.fill", coordinate: origin.location).tint(SignalStyle.blue) }
            if journey.shelter == nil, let destination = journey.destination { Marker(journey.destinationName, systemImage: "flag.fill", coordinate: destination.location).tint(.indigo) }
            ForEach(community.reports.filter { $0.status == "active" }) { report in
                Annotation(report.label, coordinate: report.coordinate.location) {
                    Button { selectedReport = report } label: {
                        Image(systemName: "exclamationmark.triangle.fill").font(.title3).foregroundStyle(.white).padding(10)
                            .background(SignalStyle.stateColor(report.reviewState), in: Circle()).overlay(Circle().stroke(.white, lineWidth: 3))
                    }.accessibilityLabel(report.label + ", " + SignalStyle.label(report.reviewState))
                }
            }
            if showPlaces {
                ForEach((context.places?.facilities ?? []).filter { $0.coordinate != journey.shelter?.coordinate }) { place in
                    Annotation(place.name, coordinate: place.coordinate.location) {
                        Button { journey.destination = place.coordinate; journey.destinationName = place.name } label: {
                            Image(systemName: place.icon).foregroundStyle(SignalStyle.gold).padding(8).background(.white, in: Circle())
                        }.accessibilityLabel("Route to " + place.name)
                    }
                }
            }
        }.mapStyle(satellite ? .hybrid : .standard(elevation: .flat))
            .overlay(alignment: .topLeading) { MapRiskLegend().padding(12) }
            .overlay(alignment: .topTrailing) {
                VStack(spacing: 12) {
                    mapButton("location.fill", label: "Recenter") {
                        if scenario.enabled { journey.origin = scenario.info?.origin } else { location.request() }
                        if let point = journey.origin { position = .region(.init(center: point.location, span: .init(latitudeDelta: 0.025, longitudeDelta: 0.025))) }
                    }
                    mapButton(satellite ? "map" : "globe.americas.fill", label: "Change map appearance") { satellite.toggle() }
                    mapButton(showPlaces ? "building.2.fill" : "building.2", label: "Toggle places") { showPlaces.toggle() }
                    mapButton("plus.bubble.fill", label: "Share observation") { showReport = true }
                }.padding(16)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    Button { showSearch = true } label: {
                        HStack { Image(systemName: "magnifyingglass"); VStack(alignment: .leading, spacing: 3) {
                            Text(journey.destination == nil ? "Where are you headed?" : journey.destinationName).font(.headline).lineLimit(1)
                            Text("Search places or set coordinates").font(.caption).foregroundStyle(.secondary)
                        }; Spacer(); Image(systemName: "chevron.right") }.foregroundStyle(SignalStyle.blue)
                    }
                    if let error = journey.error ?? location.error { Text(error).font(.caption).foregroundStyle(.red).lineLimit(3) }
                    if community.error != nil { Text("Report refresh failed; markers may be stale.").font(.caption).foregroundStyle(.orange) }
                    if let mapError = community.mapError { Text(mapError).font(.caption).foregroundStyle(.red).lineLimit(2) }
                    HStack {
                        Button { showReport = true } label: { Label("Report blocked route", systemImage: "camera.fill") }
                        Spacer()
                        Button { navigation.tab = "help" } label: { Label("Help", systemImage: "hand.raised") }
                    }.font(.subheadline.bold())
                    PrimaryButton(title: "Route to shelter", icon: "location.north.line.fill", busy: journey.busy, disabled: journey.origin == nil) {
                        Task { await community.load(); await journey.routeToShelter(); showAlternatives = false; frameSelectedRoute() }
                    }
                    if let site = journey.shelter, let selected = journey.assessment?.selected {
                        HStack(alignment: .top) {
                            Image(systemName: "house.lodge.fill").foregroundStyle(SignalStyle.shelterGreen)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("To " + site.name).font(.subheadline.bold()).foregroundStyle(SignalStyle.shelterGreen)
                                Text("\(max(1, Int(ceil(selected.durationS / 60)))) min · \((selected.distanceM / 1000).formatted(.number.precision(.fractionLength(1)))) km").font(.caption)
                            }
                            Spacer()
                            Button { showAlternatives.toggle(); frameSelectedRoute() } label: { Image(systemName: showAlternatives ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle") }.accessibilityLabel(showAlternatives ? "Hide alternative routes" : "Show alternative routes")
                        }
                    }
                    HStack {
                        Button("Assess destination") { Task { await journey.assess(); position = .automatic; showRoutes = journey.assessment != nil } }.disabled(journey.input == nil || journey.busy)
                        Spacer()
                        if journey.assessment != nil { Button("Directions & alternatives") { showRoutes = true } }
                    }.font(.caption.bold())
                    Text(scenario.enabled ? "Schematic routes · simulated conditions" : "Driving route screening · reported conditions only").font(.caption2).foregroundStyle(.secondary)
                }.padding(18).background(.regularMaterial)
            }
            .navigationTitle("Journey map").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { navigation.ask("Explain the route assessment and nearby reports") } label: { Image(systemName: "sparkles") }.accessibilityLabel("Ask Nav AI") } }
            .sheet(isPresented: $showSearch) { DestinationSearch() }
            .sheet(isPresented: $showReport) { ReportForm() }
            .sheet(isPresented: $showRoutes) { NavigationStack { RouteComparisonView() }.presentationDetents([.medium, .large]) }
            .sheet(item: $selectedReport) { report in NavigationStack { ReportDetailView(report: report) }.presentationDetents([.medium, .large]) }
            .task { await community.load(); if let origin = journey.origin, context.places == nil { await context.load(origin) } }
            .onChange(of: journey.assessment?.generatedAt) { _, _ in if journey.shelter != nil { frameSelectedRoute() } }
            .onChange(of: journey.origin) { _, value in if let value { position = .region(.init(center: value.location, span: .init(latitudeDelta: 0.025, longitudeDelta: 0.025))) } }
    }
    private func frameSelectedRoute() {
        guard let selected = journey.assessment?.selected, !selected.coordinates.isEmpty else { position = .automatic; return }
        let points = selected.coordinates
        let minLat = points.map(\.latitude).min()!, maxLat = points.map(\.latitude).max()!
        let minLon = points.map(\.longitude).min()!, maxLon = points.map(\.longitude).max()!
        position = .region(.init(center: .init(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: .init(latitudeDelta: max(0.006, (maxLat - minLat) * 1.65), longitudeDelta: max(0.006, (maxLon - minLon) * 1.65))))
    }
    private func mapButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).frame(width: 44, height: 44).background(.regularMaterial, in: Circle()) }.accessibilityLabel(label)
    }
}
struct RouteComparisonView: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var scenario: ScenarioStore
    @EnvironmentObject private var navigation: AppNavigation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let assessment = journey.assessment {
                    Text(assessment.selectedId == nil ? "No remaining candidate" : journey.destinationName).font(.title2.bold())
                    ForEach(assessment.candidates) { route in
                        SignalCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Label(route.excluded ? "Avoid reported hazard" : route.id == assessment.selectedId ? (journey.shelter == nil ? "Selected candidate" : "Selected shelter route") : "Alternative candidate", systemImage: route.excluded ? "xmark.octagon" : "arrow.triangle.turn.up.right.diamond").font(.headline).foregroundStyle(route.excluded ? .red : journey.shelter != nil && route.id == assessment.selectedId ? SignalStyle.shelterGreen : SignalStyle.blue)
                                Text("\(Int((route.durationS / 60).rounded(.up))) min \(scenario.enabled ? "simulated" : "driving") · \((route.distanceM / 1000).formatted(.number.precision(.fractionLength(1)))) km").font(.title3.bold())
                                if route.findings.isEmpty { Text("No nearby reports found. Conditions remain unknown.").font(.footnote).foregroundStyle(.secondary) }
                                ForEach(route.findings) { finding in
                                    VStack(alignment: .leading, spacing: 5) { Text(finding.label).font(.subheadline.bold()); StatusPill(state: finding.reviewState); Text(finding.reason).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                    if let selected = assessment.selected, let steps = selected.steps, !steps.isEmpty {
                        SignalCard {
                            VStack(alignment: .leading, spacing: 14) {
                                Text("Directions").font(.headline)
                                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                                    HStack(alignment: .top) {
                                        Text("\(index + 1)").font(.caption.bold()).padding(6).background(.thinMaterial, in: Circle())
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(step.instruction).font(.subheadline)
                                            Text("\(Int(step.distanceM)) m").font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let site = journey.shelter { Text("Shelter: \(site.name) · \(site.source) · checked \(Wire.date(site.checkedAt))").font(.caption).foregroundStyle(.secondary) }
                    Button("Ask Nav AI to explain") { dismiss(); navigation.ask("Why was this route selected and which reports excluded the alternatives?") }.buttonStyle(.bordered)
                    Text("Assessed \(Wire.date(assessment.generatedAt)) · \(assessment.source)").font(.caption).foregroundStyle(.secondary)
                    Notice(text: assessment.notice)
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Route comparison").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
}
struct DestinationSearch: View {
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var context: ContextStore
    @EnvironmentObject private var scenario: ScenarioStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""; @State private var results: [MKMapItem] = []
    @State private var busy = false; @State private var error: String?; @State private var manual = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Search a destination", text: $query).submitLabel(.search).onSubmit { Task { await search() } }
                    if !scenario.enabled { Button("Search places") { Task { await search() } }.disabled(busy || query.isEmpty) }
                    if busy { ProgressView() }
                    ErrorNotice(message: error)
                }
                Section(scenario.enabled ? "Destinations" : "Mapped places nearby") {
                    ForEach((context.places?.facilities ?? []).filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { place in
                        Button { choose(place.coordinate, name: place.name) } label: { Label(place.name, systemImage: place.icon) }
                    }
                    if scenario.enabled, let destination = scenario.info?.destination { Button("Community centre") { choose(destination, name: scenario.info?.destinationName ?? "Destination") } }
                }
                if !results.isEmpty {
                    Section("Search results") {
                        ForEach(Array(results.enumerated()), id: \.offset) { _, item in
                            Button { choose(.init(latitude: item.placemark.coordinate.latitude, longitude: item.placemark.coordinate.longitude), name: item.name ?? "Destination") } label: {
                                VStack(alignment: .leading) { Text(item.name ?? "Destination"); Text(item.placemark.title ?? "").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                Section {
                    Button("Enter start and destination coordinates") { manual = true }
                    Text("Mapped places are not confirmed open shelters. Check availability before making a journey.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle("Where to?").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
                .sheet(isPresented: $manual) { RouteForm() }
        }
    }
    private func choose(_ coordinate: Coordinate, name: String) { journey.destination = coordinate; journey.destinationName = name; dismiss() }
    private func search() async {
        guard !scenario.enabled, !busy, !query.isEmpty else { return }; busy = true; error = nil; defer { busy = false }
        let request = MKLocalSearch.Request(); request.naturalLanguageQuery = query
        if let origin = journey.origin { request.region = .init(center: origin.location, span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)) }
        do { results = try await MKLocalSearch(request: request).start().mapItems; if results.isEmpty { error = "No places found. Try another name or enter coordinates." } } catch { self.error = error.localizedDescription }
    }
}
struct RouteForm: View {
    @EnvironmentObject private var scenario: ScenarioStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss
    @State private var startLat = ""; @State private var startLon = ""
    @State private var endLat = ""; @State private var endLon = ""; @State private var name = ""
    var valid: Bool { Coordinate.parse(startLat, startLon) != nil && Coordinate.parse(endLat, endLon) != nil && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var body: some View {
        NavigationStack {
            Form {
                CoordinateFields(title: "Starting point", latitude: $startLat, longitude: $startLon)
                Section("Destination") { TextField("Place name", text: $name) }
                CoordinateFields(title: "Destination coordinates", latitude: $endLat, longitude: $endLon)
                Section { Text("Enter coordinates for a known destination. This prototype does not verify shelter availability.").font(.footnote) }
            }.navigationTitle("Plan a journey").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Apply") {
                        journey.origin = Coordinate.parse(startLat, startLon)
                        journey.destination = Coordinate.parse(endLat, endLon)
                        journey.destinationName = String(name.prefix(160)); dismiss()
                    }.disabled(!valid) }
                }
                .onAppear {
                    if let c = journey.origin { startLat = String(c.latitude); startLon = String(c.longitude) }
                    if let c = journey.destination { endLat = String(c.latitude); endLon = String(c.longitude) }
                    name = journey.destination == nil ? "" : journey.destinationName
                }
        }
    }
}
