import SwiftUI
import MapKit

struct JourneyView: View {
    @EnvironmentObject private var scenario: ScenarioStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var location: LocationProvider
    @State private var position: MapCameraPosition = .automatic
    @State private var showRouteForm = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Know what is ahead.").font(.title2.bold())
                        Text("Community signals for your next step.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { if scenario.enabled { scenario.useStart(journey) } else { location.request() } } label: { Image(systemName: "location.fill").padding(12) }
                        .buttonStyle(.bordered).accessibilityLabel(scenario.enabled ? "Use demo starting point" : "Use my current location")
                }
                Map(position: $position) {
                    if let origin = journey.origin { Marker("Starting point", systemImage: "location.fill", coordinate: origin.location).tint(SignalStyle.blue) }
                    if let destination = journey.destination { Marker(journey.destinationName, systemImage: "flag.fill", coordinate: destination.location).tint(.indigo) }
                    ForEach(community.reports.filter { $0.status == "active" }) { report in
                        Marker(report.label + " · " + SignalStyle.label(report.reviewState), systemImage: "exclamationmark.triangle.fill", coordinate: report.coordinate.location)
                            .tint(SignalStyle.stateColor(report.reviewState))
                    }
                    if let assessment = journey.assessment {
                        ForEach(assessment.candidates) { route in
                            MapPolyline(coordinates: route.coordinates)
                                .stroke(route.excluded ? Color.red.opacity(0.55) : route.id == assessment.selectedId ? SignalStyle.blue : Color.gray, lineWidth: 5)
                        }
                    }
                }.mapStyle(.standard(elevation: .flat)).frame(height: 310)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .accessibilityLabel("Map of selected coordinates, reports and assessed driving routes")
                ErrorNotice(message: location.error)
                ErrorNotice(message: community.error.map { "Report refresh failed. Previously loaded markers may be stale. " + $0 })
                SignalCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label(journey.destination == nil ? "Where are you headed?" : journey.destinationName, systemImage: "mappin.and.ellipse").font(.headline)
                        Text(journey.origin == nil ? "Set your starting point or use your location." : "Starting point: \(journey.origin!.latitude.formatted(.number.precision(.fractionLength(4)))), \(journey.origin!.longitude.formatted(.number.precision(.fractionLength(4))))")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Set start and destination") { showRouteForm = true }.buttonStyle(.bordered)
                        PrimaryButton(title: "Assess driving routes", icon: "arrow.triangle.branch", busy: journey.busy, disabled: journey.input == nil) {
                            Task { await community.load(); await journey.assess(); position = .automatic }
                        }
                    }
                }
                ErrorNotice(message: journey.error)
                if let assessment = journey.assessment {
                    Text(assessment.selectedId == nil ? "No remaining candidate" : "Route assessment").font(.title3.bold())
                    ForEach(assessment.candidates) { route in
                        SignalCard {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Label(route.excluded ? "Excluded by reviewed report" : route.id == assessment.selectedId ? "Selected candidate" : "Alternative candidate",
                                          systemImage: route.excluded ? "xmark.octagon" : "arrow.triangle.turn.up.right.diamond")
                                        .font(.headline).foregroundStyle(route.excluded ? Color.red : SignalStyle.blue)
                                }
                                Text("\(Int((route.durationS / 60).rounded(.up))) min \(scenario.enabled ? "simulated" : "driving") · \((route.distanceM / 1000).formatted(.number.precision(.fractionLength(1)))) km")
                                if route.findings.isEmpty { Text("No nearby reports found. Conditions remain unknown.").font(.footnote).foregroundStyle(.secondary) }
                                ForEach(route.findings) { finding in
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(finding.label).font(.subheadline.bold())
                                        StatusPill(state: finding.reviewState)
                                        Text(finding.reason).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    Text("Assessed \(Wire.date(assessment.generatedAt)) · \(assessment.source)").font(.caption).foregroundStyle(.secondary)
                    Notice(text: assessment.notice)
                } else if !journey.busy {
                    Notice(text: "Route screening checks reported points. Road conditions outside those points are unknown.")
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("WaySignal").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { NavigationLink { AccountView() } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("Your workspace") } }
            .sheet(isPresented: $showRouteForm) { RouteForm() }
            .task { await community.load() }
            .refreshable { await community.load(); if journey.input != nil { await journey.assess() } }
            .onChange(of: journey.origin) { _, value in
                if let value { position = .region(MKCoordinateRegion(center: value.location, span: .init(latitudeDelta: 0.04, longitudeDelta: 0.04))) }
            }
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
