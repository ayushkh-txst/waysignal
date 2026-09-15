import SwiftUI
import PhotosUI
import UIKit
import MapKit

struct CommunityView: View {
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var journey: JourneyStore
    @State private var showReport = false; @State private var allStates = false; @State private var scope = "All"
    var shown: [CommunityReport] {
        community.reports.filter { report in
            guard allStates || report.status == "active" else { return false }
            if scope == "Mine" { return report.isMine == true }
            if scope == "Nearby" { guard let origin = journey.origin else { return false }; return CLLocation(latitude: origin.latitude, longitude: origin.longitude).distance(from: CLLocation(latitude: report.latitude, longitude: report.longitude)) <= 3500 }
            if scope == "Route" { guard let route = journey.assessment?.selected else { return false }; return route.findings.contains { $0.reportId == report.id } }
            return true
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("One observation.\nA better next journey.").font(.system(size: 28, weight: .bold, design: .serif))
                PrimaryButton(title: "Share an observation", icon: "plus.bubble") { showReport = true }
                Picker("Report view", selection: $scope) { ForEach(["All", "Nearby", "Route", "Mine"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                Toggle("Include closed reports", isOn: $allStates).font(.subheadline)
                ErrorNotice(message: community.error)
                if community.busy { ProgressView("Refreshing reports…") }
                if shown.isEmpty && !community.busy { ContentUnavailableView("No reports in this view", systemImage: "bubble.left.and.bubble.right", description: Text(scope == "Route" ? "Assess a route in Map to see nearby findings." : "No reports does not establish road safety.")) }
                ForEach(shown) { report in
                    NavigationLink { ReportDetailView(report: report) } label: { ReportCard(report: report) }.buttonStyle(.plain)
                }
                if let date = community.loadedAt { Text("Updated \(date.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Community").navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showReport) { ReportForm() }.task { await community.load() }.refreshable { await community.load() }
    }
}
struct ReportCard: View {
    let report: CommunityReport
    var body: some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack { Image(systemName: "exclamationmark.bubble.fill").foregroundStyle(SignalStyle.stateColor(report.reviewState)); Text(report.label).font(.headline); Spacer(); Image(systemName: "chevron.right").font(.caption) }
                StatusPill(state: report.reviewState)
                if let note = report.observation, !note.isEmpty { Text(note).font(.subheadline).lineLimit(3) }
                if !report.reviewNote.isEmpty { Text(report.reviewNote).font(.subheadline).foregroundStyle(.secondary) }
                HStack { Text(report.id); Spacer(); if report.hasPhoto { Image(systemName: "photo") }; if report.isMine == true { Text("YOUR REPORT").font(.caption2.bold()) } }.font(.caption.monospaced()).foregroundStyle(.secondary)
                Text(Wire.date(report.updatedAt)).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
struct ReportDetailView: View {
    let report: CommunityReport
    @EnvironmentObject private var session: SessionStore
    @State private var history: [ReviewEvent] = []; @State private var photo: UIImage?; @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Map { Marker(report.label, coordinate: report.coordinate.location).tint(SignalStyle.stateColor(report.reviewState)) }.frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 20))
                ReportCard(report: report)
                if let photo { Image(uiImage: photo).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18)) }
                if report.hasPhoto && report.isMine != true && session.account?.user.role != "worker" { Text("Photo is private to the reporter and responders.").font(.caption).foregroundStyle(.secondary) }
                Text("Review history").font(.headline)
                if history.isEmpty { Text("No review recorded yet.").font(.subheadline).foregroundStyle(.secondary) }
                ForEach(history) { event in
                    SignalCard { VStack(alignment: .leading, spacing: 8) { StatusPill(state: event.decision); Text(event.note); Text(Wire.date(event.createdAt)).font(.caption).foregroundStyle(.secondary) } }
                }
                Text("Location: \(report.latitude), \(report.longitude)").font(.caption.monospacedDigit()).textSelection(.enabled)
                ErrorNotice(message: error)
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Observation").navigationBarTitleDisplayMode(.inline)
            .task {
                guard let client = session.client else { return }
                do {
                    history = try await client.request("mobile/community/\(report.id)/history")
                    if report.hasPhoto && (report.isMine == true || session.account?.user.role == "worker") {
                        struct PhotoPayload: Decodable { let dataUrl: String }
                        let result: PhotoPayload = try await client.request("hazards/\(report.id)/photo")
                        if let segment = result.dataUrl.split(separator: ",", maxSplits: 1).last, let data = Data(base64Encoded: String(segment)) { photo = UIImage(data: data) }
                    }
                } catch { self.error = error.localizedDescription }
            }
    }
}
struct ReportForm: View {
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "road_blocked"; @State private var lat = ""; @State private var lon = ""
    @State private var note = ""
    @State private var item: PhotosPickerItem?; @State private var photo: String?
    @State private var requestId = UUID(); @State private var busy = false; @State private var error: String?
    @State private var savedId: String?; @State private var photoBusy = false
    var body: some View {
        NavigationStack {
            Form {
                if let savedId {
                    Section {
                        Label("Observation received", systemImage: "checkmark.circle.fill").foregroundStyle(.teal)
                        Text("Your report is awaiting responder review.")
                        Text(savedId).font(.caption.monospaced())
                        Button("Done") { dismiss() }
                    }
                } else {
                    Section("What did you observe?") {
                        Picker("Type", selection: $kind) {
                            Text("Road blocked").tag("road_blocked"); Text("Flooded road").tag("flooded_road")
                            Text("Debris").tag("debris"); Text("Other hazard").tag("other")
                        }
                    }
                    Section("What should others know?") { TextField("Describe what you saw", text: $note, axis: .vertical).lineLimit(3...5); Text("\(note.count)/500").font(.caption).foregroundStyle(note.count > 500 ? .red : .secondary) }
                    CoordinateFields(title: "Observation location", latitude: $lat, longitude: $lon)
                    Section("Photo · optional") {
                        PhotosPicker(selection: $item, matching: .images) { Label(photo == nil ? "Attach photo" : "Replace attached photo", systemImage: "photo") }
                        if photoBusy { ProgressView("Preparing photo…") }
                        if photo != nil { Button("Remove photo", role: .destructive) { item = nil; photo = nil } }
                    }
                    Section {
                        Text("This report and its coordinates will be visible to other signed-in users. Photos are available to you and responders.").font(.footnote)
                        ErrorNotice(message: error)
                        PrimaryButton(title: "Submit observation", icon: "paperplane", busy: busy, disabled: Coordinate.parse(lat, lon) == nil || photoBusy || note.count > 500) { Task { await submit() } }
                    }
                }
            }.navigationTitle("Share an observation").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
                .disabled(busy)
                .onAppear { if let c = journey.origin { lat = String(c.latitude); lon = String(c.longitude) } }
                .onChange(of: note) { _, _ in requestId = UUID() }
                .onChange(of: kind) { _, _ in requestId = UUID() }
                .onChange(of: lat) { _, _ in requestId = UUID() }.onChange(of: lon) { _, _ in requestId = UUID() }
                .onChange(of: photo) { _, _ in requestId = UUID() }
                .task(id: item) {
                    guard let item else { return }; photoBusy = true
                    defer { photoBusy = false }
                    do {
                        guard let bytes = try await item.loadTransferable(type: Data.self), bytes.count <= 25_000_000,
                              let image = UIImage(data: bytes), image.size.width > 0, image.size.height > 0 else { throw APIError(message: "Choose a smaller image.") }
                        let ratio = min(1, 1200 / max(image.size.width, image.size.height))
                        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
                        let format = UIGraphicsImageRendererFormat(); format.scale = 1
                        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                        guard let data = rendered.jpegData(compressionQuality: 0.65) else { throw APIError(message: "This image could not be prepared.") }
                        try Task.checkCancellation(); photo = data.base64EncodedString(); error = nil
                    } catch is CancellationError { } catch { self.error = error.localizedDescription }
                }
        }.interactiveDismissDisabled(busy)
    }
    private func submit() async {
        guard let coordinate = Coordinate.parse(lat, lon), !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let report = try await community.service.create(kind: kind, coordinate: coordinate, photo: photo, requestId: requestId, note: note)
            savedId = report.id; journey.assessment = nil; await community.load()
        } catch { self.error = error.localizedDescription }
    }
}
