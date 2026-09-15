import SwiftUI
import PhotosUI
import UIKit

struct CommunityView: View {
    @EnvironmentObject private var community: CommunityStore
    @State private var showReport = false
    @State private var allStates = false
    var shown: [CommunityReport] { community.reports.filter { allStates || $0.status == "active" } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("One observation can change the next journey.").font(.title2.bold())
                PrimaryButton(title: "Share an observation", icon: "plus.bubble") { showReport = true }
                Toggle("Include resolved and rejected reports", isOn: $allStates).font(.subheadline)
                ErrorNotice(message: community.error)
                if community.busy { ProgressView("Refreshing reports…") }
                if shown.isEmpty && !community.busy {
                    ContentUnavailableView("No reports in this view", systemImage: "bubble.left.and.bubble.right", description: Text("No reports does not mean no hazards. Share what you have observed."))
                }
                ForEach(shown) { report in
                    SignalCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Image(systemName: "exclamationmark.bubble.fill").foregroundStyle(SignalStyle.stateColor(report.reviewState)); Text(report.label).font(.headline); Spacer() }
                            StatusPill(state: report.reviewState)
                            Text("\(report.latitude.formatted(.number.precision(.fractionLength(5)))), \(report.longitude.formatted(.number.precision(.fractionLength(5))))").font(.subheadline.monospacedDigit())
                            if !report.reviewNote.isEmpty { Text(report.reviewNote).font(.subheadline) }
                            Text("\(report.reporterSource.capitalized) observation · \(Wire.date(report.createdAt))").font(.caption).foregroundStyle(.secondary)
                            if report.hasPhoto { Label("Photo attached · available to the reporter and responders", systemImage: "photo").font(.caption).foregroundStyle(.secondary) }
                            Text(report.id).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                }
                if let date = community.loadedAt { Text("Last fetched \(date.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
                Notice(text: "Observations enter the responder review queue. Reviewed active reports affect the route assessment; a review is not official road certification.")
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Community")
            .sheet(isPresented: $showReport) { ReportForm() }
            .task { await community.load() }.refreshable { await community.load() }
    }
}
struct ReportForm: View {
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "road_blocked"; @State private var lat = ""; @State private var lon = ""
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
                    CoordinateFields(title: "Observation location", latitude: $lat, longitude: $lon)
                    Section("Photo · optional") {
                        PhotosPicker(selection: $item, matching: .images) { Label(photo == nil ? "Attach photo" : "Replace attached photo", systemImage: "photo") }
                        if photoBusy { ProgressView("Preparing photo…") }
                        if photo != nil { Button("Remove photo", role: .destructive) { item = nil; photo = nil } }
                    }
                    Section {
                        Text("This report and its coordinates will be visible to other signed-in users. Photos are available to you and responders.").font(.footnote)
                        ErrorNotice(message: error)
                        PrimaryButton(title: "Submit observation", icon: "paperplane", busy: busy, disabled: Coordinate.parse(lat, lon) == nil || photoBusy) { Task { await submit() } }
                    }
                }
            }.navigationTitle("Share an observation").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
                .disabled(busy)
                .onAppear { if let c = journey.origin { lat = String(c.latitude); lon = String(c.longitude) } }
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
            let report = try await community.service.create(kind: kind, coordinate: coordinate, photo: photo, requestId: requestId)
            savedId = report.id; journey.assessment = nil; await community.load()
        } catch { self.error = error.localizedDescription }
    }
}
