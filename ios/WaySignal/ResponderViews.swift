import SwiftUI
import MapKit

struct ResponderWorkspace: View {
    let account: Account
    var body: some View {
        TabView {
            NavigationStack { OperationsOverview(account: account) }.tabItem { Label("Overview", systemImage: "square.grid.2x2") }
            NavigationStack { IncidentList(account: account) }.tabItem { Label("Incidents", systemImage: "checklist") }
            NavigationStack { OperationsMap(account: account) }.tabItem { Label("Map", systemImage: "map") }
            NavigationStack { ReviewQueue() }.tabItem { Label("Review", systemImage: "checkmark.bubble") }
            NavigationStack { OperationsReports() }.tabItem { Label("Reports", systemImage: "chart.bar") }
        }
    }
}
struct OperationsOverview: View {
    let account: Account
    @EnvironmentObject private var operations: OperationsStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var context: ContextStore
    var active: [AssistanceRequest] { operations.incidents.filter { !["resolved", "cancelled"].contains($0.status) } }
    var body: some View {
        ViewportScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("A clear picture.\nA coordinated response.").font(.system(size: 30, weight: .bold, design: .serif))
                Text("Responder workspace · \(account.displayName)").font(.subheadline).foregroundStyle(.secondary)
                LandscapeBanner(height: 100).clipShape(RoundedRectangle(cornerRadius: 18))
                HStack(alignment: .top) {
                    NavigationLink { IncidentList(account: account) } label: { MetricTile(title: "Active requests", value: "\(active.count)", icon: "hand.raised.fill", color: .orange) }
                    NavigationLink { IncidentList(account: account, title: "People in requests") } label: { MetricTile(title: "People in requests", value: "\(active.reduce(0) { $0 + $1.peopleCount })", icon: "person.2.fill") }
                }.buttonStyle(.plain)
                HStack(alignment: .top) {
                    NavigationLink { ReviewQueue() } label: { MetricTile(title: "Awaiting review", value: "\(community.reports.filter { ["unreviewed", "expired"].contains($0.reviewState) }.count)", icon: "bubble.left.and.exclamationmark.bubble.right", color: .orange) }
                    NavigationLink { IncidentList(account: account, initialScope: "Assigned") } label: { MetricTile(title: "Assigned to you", value: "\(active.filter { $0.responderId == account.id }.count)", icon: "person.crop.circle.badge.checkmark") }
                }.buttonStyle(.plain)
                ErrorNotice(message: operations.error)
                HStack { Text("Awaiting assignment").font(.title3.bold()); Spacer(); if operations.busy { ProgressView() } }
                ForEach(active.filter { $0.status == "submitted" }.prefix(4)) { request in NavigationLink { IncidentDetail(initial: request, account: account) } label: { IncidentCard(request: request) }.buttonStyle(.plain) }
                if let conditions = context.conditions { Text("Forecast context").font(.title3.bold()); ConditionsCard(conditions: conditions) }
                ViewThatFits(in: .horizontal) {
                    HStack {
                        NavigationLink { GuideView() } label: { Label("Ask Nav AI", systemImage: "sparkles") }.buttonStyle(.bordered)
                        NavigationLink { EmergencyContactsView() } label: { Label("Emergency contacts", systemImage: "phone.fill") }.buttonStyle(.bordered)
                    }.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .leading, spacing: 12) {
                        NavigationLink { GuideView() } label: { Label("Ask Nav AI", systemImage: "sparkles") }.buttonStyle(.bordered)
                        NavigationLink { EmergencyContactsView() } label: { Label("Emergency contacts", systemImage: "phone.fill") }.buttonStyle(.bordered)
                    }
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Operations").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { AccountView() } label: { Image(systemName: "person.crop.circle") }
                        .accessibilityLabel("Admin profile")
                        .accessibilityHint("View your account and sign out")
                }
            }
            .refreshable { await operations.load(); await community.load() }
    }
}
struct IncidentCard: View {
    let request: AssistanceRequest
    var body: some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack { Text(request.emergencyType.capitalized).font(.headline); Spacer() }
                Text("\(request.citizenName) · \(request.peopleCount) \(request.peopleCount == 1 ? "person" : "people")").font(.subheadline)
                StatusPill(state: request.status)
                if let name = request.responderName { Label(name, systemImage: "person.crop.circle").font(.caption) }
                Text(SignalCopy.recordID(request.id)).font(.caption.monospaced()).foregroundStyle(.secondary)
            }
        }
    }
}
struct IncidentList: View {
    let account: Account
    @EnvironmentObject private var operations: OperationsStore
    let title: String
    @State private var scope: String; @State private var query = ""
    init(account: Account, initialScope: String = "Active", title: String = "Incidents") {
        self.account = account; self.title = title; _scope = State(initialValue: initialScope)
    }
    var shown: [AssistanceRequest] {
        operations.incidents.filter { request in
            let matches = query.isEmpty || (request.id + request.citizenName + request.notes).localizedCaseInsensitiveContains(query)
            return matches && (scope == "All" || scope == "Assigned" && request.responderId == account.id && !["resolved", "cancelled"].contains(request.status) || scope == "Active" && !["resolved", "cancelled"].contains(request.status))
        }
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("Scope", selection: $scope) { ForEach(["Active", "Assigned", "All"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                ErrorNotice(message: operations.error)
                if operations.busy { ProgressView() }
                Text("\(shown.reduce(0) { $0 + $1.peopleCount }) people · \(shown.count) requests").font(.subheadline).foregroundStyle(.secondary)
                ForEach(shown) { request in NavigationLink { IncidentDetail(initial: request, account: account) } label: { IncidentCard(request: request) }.buttonStyle(.plain) }
                if shown.isEmpty && !operations.busy { ContentUnavailableView("No matching incidents", systemImage: "tray") }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle(title).searchable(text: $query, prompt: "Name, ID or details")
            .task { await operations.load() }.refreshable { await operations.load() }
    }
}
struct IncidentDetail: View {
    let initial: AssistanceRequest; let account: Account
    @EnvironmentObject private var operations: OperationsStore
    @State private var confirmation: String?
    var request: AssistanceRequest { operations.incidents.first { $0.id == initial.id } ?? initial }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                IncidentCard(request: request)
                Map(initialPosition: .region(MKCoordinateRegion(center: request.coordinate.location, span: .init(latitudeDelta: 0.012, longitudeDelta: 0.012)))) {
                    Marker(request.citizenName, coordinate: request.coordinate.location).tint(.orange)
                }.frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 20))
                if !["resolved", "cancelled"].contains(request.status) {
                    NavigationLink { ResponderNavigationView(initial: request) } label: {
                        Label("Route to " + request.citizenName, systemImage: "location.fill").font(.headline).frame(maxWidth: .infinity).padding(16).foregroundStyle(.white).background(SignalStyle.blue, in: RoundedRectangle(cornerRadius: 16))
                    }.buttonStyle(.plain)
                }
                Text("Coordinates: \(request.latitude), \(request.longitude)").font(.caption.monospaced()).textSelection(.enabled)
                if !request.notes.isEmpty { SignalCard { VStack(alignment: .leading, spacing: 8) { Text("Request details").font(.headline); Text(request.notes) } } }
                SignalCard { RequestTimeline(request: request) }
                ErrorNotice(message: operations.error)
                if request.status == "submitted" {
                    PrimaryButton(title: "Assign to me", icon: "person.badge.plus", busy: operations.busy) { confirmation = "assigned" }
                } else if request.status == "assigned" {
                    PrimaryButton(title: "Mark en route", icon: "location.fill", busy: operations.busy) { confirmation = "en_route" }
                } else if request.status == "en_route" {
                    PrimaryButton(title: "Mark assistance complete", icon: "checkmark.circle", busy: operations.busy) { confirmation = "resolved" }
                }
                Text("Updates are shared with the requesting citizen. Record only actions your team has taken.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle(SignalCopy.recordID(request.id)).navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Record this status update?", isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })) {
                if let status = confirmation { Button(SignalStyle.label(status)) { Task { await operations.transition(request, to: status, account: account) }; confirmation = nil } }
            }
            .refreshable { await operations.load() }
    }
}
struct OperationsMap: View {
    let account: Account
    @EnvironmentObject private var operations: OperationsStore
    @EnvironmentObject private var community: CommunityStore
    @State private var selected: AssistanceRequest?; @State private var selectedReport: CommunityReport?
    @State private var showShelters = false
    var body: some View {
        Map {
            MapRiskLayer(snapshot: community.mapState)
            ForEach((community.mapState?.shelters ?? []).filter { $0.available }) { site in
                Marker(site.name, systemImage: "house.lodge.fill", coordinate: site.coordinate.location).tint(.green)
            }
            ForEach(operations.incidents.filter { !["resolved", "cancelled"].contains($0.status) }) { request in
                Annotation(SignalCopy.recordID(request.id), coordinate: .init(latitude: request.latitude, longitude: request.longitude)) {
                    Button { selected = request } label: { Image(systemName: "hand.raised.fill").foregroundStyle(.white).padding(12).background(SignalStyle.stateColor(request.status), in: Circle()).overlay(Circle().stroke(.white, lineWidth: 2)) }
                }
            }
            ForEach(community.reports.filter { $0.status == "active" }) { report in
                Annotation(report.label, coordinate: report.coordinate.location) {
                    Button { selectedReport = report } label: {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.white).padding(10).background(SignalStyle.stateColor(report.reviewState), in: Circle())
                    }.accessibilityLabel("Review " + report.label)
                }
            }
        }.navigationTitle("Operations map").navigationBarTitleDisplayMode(.inline)
            .overlay(alignment: .topLeading) { MapRiskLegend().padding(12) }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    NavigationLink { IncidentList(account: account) } label: { Label("Choose a request for directions", systemImage: "location.fill") }.font(.headline)
                    Button { showShelters = true } label: { Label("Manage safe points & shelters", systemImage: "house.lodge.fill") }.font(.subheadline.bold())
                    Text("Tap a hazard to review its photo and update the shared map.").font(.caption)
                    ErrorNotice(message: community.error ?? community.mapError)
                }.padding(14).frame(maxWidth: .infinity).background(.regularMaterial)
            }
            .sheet(item: $selected) { request in NavigationStack { IncidentDetail(initial: request, account: account) }.presentationDetents([.medium, .large]) }
            .sheet(item: $selectedReport) { report in NavigationStack { ReviewDetail(initial: report) }.presentationDetents([.medium, .large]) }
            .sheet(isPresented: $showShelters) { ShelterManagementView() }
            .task { await operations.load(); await community.load() }
    }
}
struct ShelterManagementView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var latitude = ""; @State private var longitude = ""; @State private var note = ""
    @State private var busy = false; @State private var error: String?; @State private var pin = false; @State private var closing: ShelterSite?
    var body: some View {
        NavigationStack {
            Form {
                Section("Recorded shelters") {
                    ForEach(community.mapState?.shelters ?? []) { site in
                        VStack(alignment: .leading, spacing: 6) {
                            Label(site.name, systemImage: "house.lodge.fill").foregroundStyle(site.available ? .green : .secondary)
                            Text("\(site.status.replacingOccurrences(of: "_", with: " ")) · \(site.source)").font(.caption)
                            Text("Checked \(Wire.date(site.checkedAt))").font(.caption).foregroundStyle(.secondary)
                            if site.status != "closed" { Button("Close shelter", role: .destructive) { closing = site }.disabled(busy) }
                        }
                    }
                }
                Section("Confirm an open shelter") {
                    TextField("Shelter name", text: $name)
                    TextField("Who confirmed access and availability?", text: $note, axis: .vertical)
                    Text("Confirmation expires after 4 hours. Nearby hazards remove the green status automatically.").font(.caption).foregroundStyle(.secondary)
                    Button("Choose on map") { pin = true }
                }
                CoordinateFields(title: "Shelter location", latitude: $latitude, longitude: $longitude)
                ErrorNotice(message: error)
                PrimaryButton(title: "Confirm shelter is open", icon: "checkmark.shield", busy: busy,
                    disabled: Coordinate.parse(latitude, longitude) == nil || name.trimmingCharacters(in: .whitespaces).count < 2 || note.trimmingCharacters(in: .whitespaces).count < 5) { Task { await create() } }
            }.navigationTitle("Safe points").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .sheet(isPresented: $pin) { ReportPinPicker(latitude: $latitude, longitude: $longitude) }
                .confirmationDialog("Close this shelter on both maps?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } })) {
                    if let site = closing { Button("Close " + site.name, role: .destructive) { Task { await close(site) }; closing = nil } }
                }
                .onAppear { if let point = journey.origin { latitude = String(point.latitude); longitude = String(point.longitude) } }
        }
    }
    private func create() async {
        guard !busy, let client = session.client, let point = Coordinate.parse(latitude, longitude) else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let _: SavedReport = try await client.request("mobile/shelters", method: "POST", body: Wire.encode(ShelterInput(name: name, latitude: point.latitude, longitude: point.longitude, note: note, validHours: 4)))
            name = ""; note = ""; await community.load()
        } catch { self.error = error.localizedDescription }
    }
    private func close(_ site: ShelterSite) async {
        guard !busy, let client = session.client else { return }; busy = true; error = nil; defer { busy = false }
        do { let _: SavedReport = try await client.request("mobile/shelters/\(site.id)/close", method: "POST"); await community.load() }
        catch { self.error = error.localizedDescription }
    }
}
struct ReviewQueue: View {
    @EnvironmentObject private var community: CommunityStore
    @State private var all = false
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Toggle("Include reviewed and closed reports", isOn: $all)
                ErrorNotice(message: community.error)
                ForEach(community.reports.filter { all || ["unreviewed", "expired"].contains($0.reviewState) }) { report in
                    NavigationLink { ReviewDetail(initial: report) } label: { ReportCard(report: report) }.buttonStyle(.plain)
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Community review").navigationBarTitleDisplayMode(.inline)
            .task { await community.load() }.refreshable { await community.load() }
    }
}
struct ReviewDetail: View {
    let initial: CommunityReport
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var operations: OperationsStore
    @EnvironmentObject private var journey: JourneyStore
    @State private var note = ""; @State private var error: String?; @State private var busy = false; @State private var decision: String?
    var report: CommunityReport { community.reports.first { $0.id == initial.id } ?? initial }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ReportCard(report: report)
                NavigationLink { ReportDetailView(report: report) } label: { Label("Location, photo and review history", systemImage: "doc.text.magnifyingglass") }
                TextField("Reason for this review", text: $note, axis: .vertical).lineLimit(3...5).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 16))
                ErrorNotice(message: error)
                if report.status == "active" {
                    PrimaryButton(title: "Confirm active observation", icon: "checkmark.bubble", busy: busy, disabled: note.isEmpty || note.count > 500) { decision = "reviewed_active" }
                    Button("Reject observation", role: .destructive) { decision = "rejected" }.disabled(busy || note.isEmpty || note.count > 500)
                    if report.reviewState == "reviewed_active" { Button("Mark hazard resolved") { decision = "resolved" }.disabled(busy) }
                }
                Text("Confirming an active report can exclude nearby route candidates. A project review does not certify road safety.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Review observation").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("Save this review decision?", isPresented: Binding(get: { decision != nil }, set: { if !$0 { decision = nil } })) {
                if let selected = decision { Button(SignalStyle.label(selected)) { Task { await save(selected) }; decision = nil } }
            }
    }
    private func save(_ decision: String) async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            if decision == "resolved" { try await operations.service.resolve(report.id) } else { _ = try await operations.service.review(report, decision: decision, note: note) }
            await community.load(); await journey.refreshRoute()
        } catch { self.error = error.localizedDescription; await community.load() }
    }
}
struct OperationsReports: View {
    @EnvironmentObject private var operations: OperationsStore
    @EnvironmentObject private var session: SessionStore
    @State private var exportURL: URL?; @State private var exportError: String?; @State private var exporting = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Recorded response.\nVisible progress.").font(.system(size: 28, weight: .bold, design: .serif))
                Text("Last 7 days · persisted incident records").font(.caption).foregroundStyle(.secondary)
                if let report = operations.report {
                    HStack { MetricTile(title: "Requests", value: "\(report.summary.total)", icon: "tray.full"); MetricTile(title: "Resolved", value: "\(report.summary.resolved)", icon: "checkmark.circle.fill", color: .teal) }
                    SignalCard { VStack(alignment: .leading, spacing: 16) { Text("Request status").font(.headline); ForEach(report.statuses) { row in HStack { Text(SignalStyle.label(row.key)).font(.caption).frame(width: 80, alignment: .leading); ProgressView(value: Double(row.count), total: Double(max(report.summary.total, 1))); Text("\(row.count)").font(.caption.monospacedDigit()) } } } }
                    SignalCard { VStack(alignment: .leading, spacing: 14) { Text("Assistance types").font(.headline); ForEach(report.incidentTypes) { row in HStack { Text(row.key.capitalized); Spacer(); Text("\(row.count)").bold() } } } }
                    Text("\(report.summary.peopleInActive) people in open requests. Counts are self-reported group sizes.").font(.footnote).foregroundStyle(.secondary)
                    Text("Generated \(Wire.date(report.generatedAt))").font(.caption).foregroundStyle(.secondary)
                    PrimaryButton(title: "Prepare CSV export", icon: "square.and.arrow.up", busy: exporting) { Task { await export() } }
                    if let exportURL { ShareLink("Share report CSV", item: exportURL).buttonStyle(.bordered) }
                }
                if operations.reportBusy { ProgressView() }
                ErrorNotice(message: operations.reportError ?? exportError)
                if operations.reportError != nil { Button("Retry reports") { Task { await operations.loadReports() } } }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Reports").navigationBarTitleDisplayMode(.inline)
            .task { await operations.loadReports() }.refreshable { await operations.loadReports() }
    }
    private func export() async {
        guard let client = session.client, !exporting else { return }; exporting = true; exportError = nil; defer { exporting = false }
        do {
            var request = URLRequest(url: client.baseURL.appendingPathComponent("api/v1/admin/reports/export")); request.timeoutInterval = 25
            if let token = client.token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError(message: "Report export failed. Try again.") }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("WaySignal-Report-\(UUID().uuidString.prefix(8)).csv")
            try data.write(to: url, options: [.atomic, .completeFileProtection]); exportURL = url
        } catch { exportError = error.localizedDescription }
    }
}
