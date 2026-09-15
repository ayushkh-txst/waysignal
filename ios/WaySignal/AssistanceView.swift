import SwiftUI

struct AssistanceView: View {
    let account: Account
    @EnvironmentObject private var assistance: AssistanceStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var showForm = false
    @State private var cancelId: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("A request with a clear next step.").font(.title2.bold())
                Notice(text: "Prototype requests are shown to this project's responder team. For immediate danger, contact local emergency services.")
                if account.role == "citizen" {
                    PrimaryButton(title: "Request assistance", icon: "hand.raised") { showForm = true }
                } else {
                    NavigationLink("Open responder workspace") { AccountView() }.buttonStyle(.bordered)
                }
                ErrorNotice(message: assistance.error)
                if assistance.busy { ProgressView("Refreshing requests…") }
                if assistance.requests.isEmpty && !assistance.busy {
                    ContentUnavailableView("No requests yet", systemImage: "tray", description: Text("Submitted requests and recorded responder updates appear here."))
                }
                ForEach(assistance.requests) { request in
                    SignalCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Text(SignalCopy.recordID(request.id)).font(.headline); Spacer() }
                            StatusPill(state: request.status)
                            RequestTimeline(request: request)
                            Text("\(request.emergencyType.capitalized) · \(request.peopleCount) people").font(.subheadline)
                            if let responder = request.responderName { Label(responder, systemImage: "person.crop.circle.badge.checkmark") }
                            else if request.status == "submitted" { Text("Awaiting responder assignment.").font(.footnote).foregroundStyle(.secondary) }
                            if !request.notes.isEmpty { Text(request.notes).font(.subheadline) }
                            Text("Updated \(Wire.date(request.updatedAt ?? request.createdAt))").font(.caption).foregroundStyle(.secondary)
                            if request.status == "resolved" { Text("Assistance is marked complete. Nearby road reports keep their own review status.").font(.footnote).foregroundStyle(.secondary) }
                            if request.status == "submitted" && account.role == "citizen" {
                                Button("Cancel request", role: .destructive) { cancelId = request.id }.disabled(assistance.busy)
                            }
                        }
                    }
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Help")
            .sheet(isPresented: $showForm) { AssistanceForm(account: account) }
            .refreshable { await assistance.load() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    await assistance.load()
                    do { try await Task.sleep(for: .seconds(10)) } catch { break }
                }
            }
            .confirmationDialog("Cancel this assistance request?", isPresented: Binding(get: { cancelId != nil }, set: { if !$0 { cancelId = nil } })) {
                Button("Cancel request", role: .destructive) { if let id = cancelId { Task { await assistance.cancel(id) } }; cancelId = nil }
            }
    }
}
struct AssistanceForm: View {
    let account: Account
    @EnvironmentObject private var assistance: AssistanceStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "evacuation"; @State private var people = 1
    @State private var lat = ""; @State private var lon = ""; @State private var notes = ""
    @State private var busy = false; @State private var error: String?; @State private var saved: AssistanceRequest?
    var body: some View {
        NavigationStack {
            Form {
                if let saved {
                    Section {
                        Label("Request recorded", systemImage: "checkmark.circle.fill").foregroundStyle(.teal)
                        Text(saved.id).font(.headline); StatusPill(state: saved.status)
                        Text("This confirms receipt in the project dashboard. No responder arrival is promised.").font(.footnote)
                        Button("View status") { dismiss() }
                    }
                } else {
                    Section("Assistance needed") {
                        Picker("Type", selection: $kind) {
                            Text("Evacuation").tag("evacuation"); Text("Rescue").tag("rescue"); Text("Medical").tag("medical")
                        }
                        Stepper("People: \(people)", value: $people, in: 1...50)
                    }
                    CoordinateFields(title: "Your current location", latitude: $lat, longitude: $lon)
                    Section("Details for the responder") { TextField("Additional information", text: $notes, axis: .vertical).lineLimit(3...6) }
                    Section {
                        Text("Your name, coordinates and notes will be shared with project responders.").font(.footnote)
                        ErrorNotice(message: error)
                        PrimaryButton(title: "Send assistance request", icon: "paperplane", busy: busy, disabled: Coordinate.parse(lat, lon) == nil || notes.count > 500) { Task { await submit() } }
                    }
                }
            }.navigationTitle("Request assistance").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
                .disabled(busy)
                .onAppear { if let c = journey.origin { lat = String(c.latitude); lon = String(c.longitude) } }
        }.interactiveDismissDisabled(busy)
    }
    private func submit() async {
        guard let coordinate = Coordinate.parse(lat, lon), !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            saved = try await assistance.service.create(.init(citizenId: account.id, citizenName: account.displayName,
                emergencyType: kind, latitude: coordinate.latitude, longitude: coordinate.longitude, peopleCount: people, notes: notes))
            await assistance.load()
        } catch { self.error = error.localizedDescription + " Check your request list before retrying, in case the request was received." }
    }
}

struct RequestTimeline: View {
    let request: AssistanceRequest
    var milestones: [(String, String?)] { [("Received", request.createdAt), ("Assigned", request.assignedAt), ("En route", request.enRouteAt), ("Completed", request.resolvedAt)] }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(milestones.enumerated()), id: \.offset) { _, milestone in
                HStack(spacing: 12) {
                    Image(systemName: milestone.1 == nil ? "circle" : "checkmark.circle.fill").foregroundStyle(milestone.1 == nil ? Color.gray : Color.teal)
                    VStack(alignment: .leading, spacing: 2) { Text(milestone.0).font(.subheadline.weight(.medium)); if let date = milestone.1 { Text(Wire.date(date)).font(.caption2).foregroundStyle(.secondary) } }
                }
            }
        }.padding(.vertical, 6)
    }
}
