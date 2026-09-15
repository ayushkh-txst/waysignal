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
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("A clear picture.\nA coordinated response.").font(.system(size: 30, weight: .bold, design: .serif))
                Text("Responder workspace · \(account.name)").font(.subheadline).foregroundStyle(.secondary)
                LandscapeBanner(height: 100).clipShape(RoundedRectangle(cornerRadius: 18))
                HStack { MetricTile(title: "Active requests", value: "\(active.count)", icon: "hand.raised.fill", color: .orange); MetricTile(title: "People in requests", value: "\(active.reduce(0) { $0 + $1.peopleCount })", icon: "person.2.fill") }
                HStack { MetricTile(title: "Awaiting review", value: "\(community.reports.filter { ["unreviewed", "expired"].contains($0.reviewState) }.count)", icon: "bubble.left.and.exclamationmark.bubble.right", color: .orange); MetricTile(title: "Assigned to you", value: "\(active.filter { $0.responderId == account.id }.count)", icon: "person.crop.circle.badge.checkmark") }
                ErrorNotice(message: operations.error)
                HStack { Text("Awaiting assignment").font(.title3.bold()); Spacer(); if operations.busy { ProgressView() } }
                ForEach(active.filter { $0.status == "submitted" }.prefix(4)) { request in NavigationLink { IncidentDetail(initial: request, account: account) } label: { IncidentCard(request: request) }.buttonStyle(.plain) }
                if let conditions = context.conditions { Text("Forecast context").font(.title3.bold()); ConditionsCard(conditions: conditions) }
                NavigationLink { GuideView() } label: { Label("Ask WaySignal Guide", systemImage: "sparkles") }.buttonStyle(.bordered)
                NavigationLink { AccountView() } label: { Label("Account and full web workspace", systemImage: "person.crop.circle") }.buttonStyle(.bordered)
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Operations").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { Task { await operations.load(); await community.load() } } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("Refresh operations") } }
            .refreshable { await operations.load(); await community.load() }
    }
}
struct IncidentCard: View {
    let request: AssistanceRequest
    var body: some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack { Text(request.emergencyType.capitalized).font(.headline); Spacer(); if request.isDemo { Text("DEMO").font(.caption2.bold()).foregroundStyle(.orange) } }
                Text("\(request.citizenName) · \(request.peopleCount) people").font(.subheadline)
                StatusPill(state: request.status)
                if let name = request.responderName { Label(name, systemImage: "person.crop.circle").font(.caption) }
                Text(request.id).font(.caption.monospaced()).foregroundStyle(.secondary)
            }
        }
    }
}
struct IncidentList: View {
    let account: Account
    @EnvironmentObject private var operations: OperationsStore
    @State private var scope = "Active"; @State private var query = ""
    var shown: [AssistanceRequest] {
        operations.incidents.filter { request in
            let matches = query.isEmpty || (request.id + request.citizenName + request.notes).localizedCaseInsensitiveContains(query)
            return matches && (scope == "All" || scope == "Mine" && request.responderId == account.id || scope == "Active" && !["resolved", "cancelled"].contains(request.status))
        }
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Picker("Scope", selection: $scope) { ForEach(["Active", "Mine", "All"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                ErrorNotice(message: operations.error)
                if operations.busy { ProgressView() }
                ForEach(shown) { request in NavigationLink { IncidentDetail(initial: request, account: account) } label: { IncidentCard(request: request) }.buttonStyle(.plain) }
                if shown.isEmpty && !operations.busy { ContentUnavailableView("No matching incidents", systemImage: "tray") }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Incidents").searchable(text: $query, prompt: "Name, ID or details")
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
                Map { Marker(request.citizenName, coordinate: .init(latitude: request.latitude, longitude: request.longitude)).tint(.orange) }.frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 20))
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
        }.background(SignalStyle.background).navigationTitle(request.id).navigationBarTitleDisplayMode(.inline)
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
    @State private var selected: AssistanceRequest?
    var body: some View {
        Map {
            ForEach(operations.incidents.filter { !["resolved", "cancelled"].contains($0.status) }) { request in
                Annotation(request.id, coordinate: .init(latitude: request.latitude, longitude: request.longitude)) {
                    Button { selected = request } label: { Image(systemName: "hand.raised.fill").foregroundStyle(.white).padding(12).background(SignalStyle.stateColor(request.status), in: Circle()).overlay(Circle().stroke(.white, lineWidth: 2)) }
                }
            }
            ForEach(community.reports.filter { $0.status == "active" }) { report in Marker(report.label, systemImage: "exclamationmark.triangle", coordinate: report.coordinate.location).tint(SignalStyle.stateColor(report.reviewState)) }
        }.navigationTitle("Operations map").navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) { Text("Hands: assistance requests · Triangles: community observations").font(.caption).padding(14).frame(maxWidth: .infinity).background(.regularMaterial) }
            .sheet(item: $selected) { request in NavigationStack { IncidentDetail(initial: request, account: account) }.presentationDetents([.medium, .large]) }
            .task { await operations.load(); await community.load() }
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
            await community.load(); journey.assessment = nil
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
                ErrorNotice(message: operations.error ?? exportError)
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Reports").navigationBarTitleDisplayMode(.inline)
            .task { await operations.load() }.refreshable { await operations.load() }
    }
    private func export() async {
        guard let client = session.client, !exporting else { return }; exporting = true; exportError = nil; defer { exporting = false }
        do {
            var request = URLRequest(url: client.baseURL.appendingPathComponent("api/v1/reports/export")); request.timeoutInterval = 25
            if let token = client.token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw APIError(message: "Report export failed. Try again.") }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("WaySignal-Report-\(UUID().uuidString.prefix(8)).csv")
            try data.write(to: url, options: [.atomic, .completeFileProtection]); exportURL = url
        } catch { exportError = error.localizedDescription }
    }
}
