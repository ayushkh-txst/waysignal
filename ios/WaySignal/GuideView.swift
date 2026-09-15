import SwiftUI

struct GuideView: View {
    @EnvironmentObject private var guide: GuideStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var assistance: AssistanceStore
    @EnvironmentObject private var community: CommunityStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Image(systemName: "sparkle.magnifyingglass").font(.system(size: 36)).foregroundStyle(SignalStyle.blue)
                Text("Understand the signals.").font(.title.bold())
                Text("Short summaries linked to the records behind them.").foregroundStyle(.secondary)
                SignalCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Button {
                            let geometry = journey.assessment?.selected?.geometry.map { Coordinate(latitude: $0[0], longitude: $0[1]) }
                            Task { await guide.ask(.init(action: "reports", routeGeometry: geometry)) }
                        } label: { Label(journey.assessment?.selected == nil ? "Summarize community reports" : "Summarize reports along my route", systemImage: "bubble.left.and.text.bubble.right") }
                        Divider()
                        Button { if let input = journey.input { Task { await guide.ask(.init(action: "route", route: input)) } } } label: {
                            Label("Explain the route assessment", systemImage: "arrow.triangle.branch")
                        }.disabled(journey.input == nil)
                        if journey.input == nil { Text("Set your start and destination in Map first.").font(.caption).foregroundStyle(.secondary) }
                        Divider()
                        Menu {
                            ForEach(assistance.requests) { request in
                                Button(request.id + " · " + SignalStyle.label(request.status)) {
                                    Task { await guide.ask(.init(action: "status", requestId: request.id)) }
                                }
                            }
                        } label: { Label("Check an assistance request", systemImage: "hand.raised") }.disabled(assistance.requests.isEmpty)
                    }.buttonStyle(.borderless).disabled(guide.busy)
                }
                if guide.busy { ProgressView("Retrieving source records…").padding() }
                ErrorNotice(message: guide.error)
                if let response = guide.response {
                    SignalCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Label("Source summary", systemImage: "text.bubble").font(.caption.bold()).foregroundStyle(SignalStyle.blue)
                            Text(response.text).font(.body)
                            if !response.sources.isEmpty { Text("Source records").font(.headline) }
                            ForEach(response.sources) { source in
                                NavigationLink {
                                    SourceDetailView(source: source)
                                } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(source.id).font(.caption.monospaced()).lineLimit(1)
                                        StatusPill(state: source.status)
                                    }
                                }
                            }
                        }
                    }
                    Notice(text: response.notice)
                }
                Text("Guide reads source records through MCP. It does not send reports or assistance requests. Use the explicit forms to take action.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }.background(SignalStyle.background).navigationTitle("Guide").navigationBarTitleDisplayMode(.inline)
            .task { await assistance.load(); await community.load() }
    }
}
struct SourceDetailView: View {
    let source: GuideSource
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var assistance: AssistanceStore
    var body: some View {
        List {
            Section("Source record") { Text(source.id).font(.caption.monospaced()).textSelection(.enabled) }
            if source.kind == "report", let report = community.reports.first(where: { $0.id == source.id }) {
                Section(report.label) {
                    StatusPill(state: report.reviewState)
                    Text("\(report.latitude), \(report.longitude)")
                    Text("Updated \(Wire.date(report.updatedAt))")
                    if !report.reviewNote.isEmpty { Text(report.reviewNote) }
                }
            } else if source.kind == "assistance", let request = assistance.requests.first(where: { $0.id == source.id }) {
                Section("Assistance") {
                    StatusPill(state: request.status)
                    Text("Updated \(Wire.date(request.updatedAt ?? request.createdAt))")
                    if let name = request.responderName { Text("Responder: \(name)") }
                }
            } else { Text("Refreshing this source. If it remains unavailable, return to Community or Help and refresh.") }
            ErrorNotice(message: source.kind == "report" ? community.error : assistance.error)
        }.navigationTitle("Source details").task {
            if source.kind == "report" { await community.load() } else { await assistance.load() }
        }
    }
}
