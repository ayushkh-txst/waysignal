import SwiftUI

struct GuideView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var assistance: AssistanceStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var voice = VoiceService()
    @State private var messages: [ConversationMessage] = []
    @State private var draft = ""; @State private var busy = false; @State private var error: String?
    @State private var readAloud = false
    private let suggestions = ["Explain my route", "Rain and river forecast", "Find nearby facilities", "Summarize community reports", "Check my assistance requests"]
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if messages.isEmpty {
                        BrandHeading()
                        Text("Let's find your\nnext step.").font(.system(size: 30, weight: .bold, design: .serif))
                        Text("Ask about the reports, route options, forecasts, and assistance records available to your account.").foregroundStyle(.secondary)
                        ForEach(suggestions, id: \.self) { question in
                            Button { draft = question; Task { await send() } } label: { HStack { Text(question); Spacer(); Image(systemName: "arrow.up.right") }.padding(15).background(.white, in: RoundedRectangle(cornerRadius: 16)) }.disabled(busy)
                        }
                    }
                    ForEach(messages) { message in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(message.role == "user" ? "YOU" : message.response?.mode == "ai_grounded" ? "WAYSIGNAL AI" : "SOURCE SUMMARY").font(.caption2.bold()).tracking(1).foregroundStyle(message.role == "user" ? .white.opacity(0.8) : SignalStyle.gold)
                            Text(message.text).textSelection(.enabled)
                            if let response = message.response {
                                if !response.sources.isEmpty {
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack {
                                            ForEach(response.sources, id: \.sourceKey) { source in
                                                NavigationLink { SourceDetailView(source: source) } label: { Label(source.id, systemImage: "link").font(.caption).padding(9).background(SignalStyle.background, in: Capsule()) }
                                            }
                                        }
                                    }
                                }
                                HStack(alignment: .top) {
                                    Text(response.notice).font(.caption2).foregroundStyle(.secondary)
                                    Spacer(); Button { voice.speak(message.text) } label: { Image(systemName: "speaker.wave.2") }.accessibilityLabel("Read response aloud")
                                }
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
                            .foregroundStyle(message.role == "user" ? .white : .primary)
                            .background(message.role == "user" ? SignalStyle.blue : .white, in: RoundedRectangle(cornerRadius: 20))
                            .padding(.leading, message.role == "user" ? 30 : 0).padding(.trailing, message.role == "user" ? 0 : 16).id(message.id)
                    }
                    if busy { ProgressView("Checking source records…").padding() }
                    ErrorNotice(message: error ?? voice.error)
                    Color.clear.frame(height: 1).id("bottom")
                }.padding(20)
            }.background(SignalStyle.background)
                .onChange(of: messages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .safeAreaInset(edge: .bottom) {
                    VStack(spacing: 8) {
                        if voice.recording { Text("Listening… Tap the microphone to stop. Review the text before sending.").font(.caption).foregroundStyle(.secondary) }
                        HStack(alignment: .bottom, spacing: 12) {
                            Button { if voice.recording { voice.stop() } else { Task { await voice.start() } } } label: { Image(systemName: voice.recording ? "stop.circle.fill" : "mic.fill").font(.title3).frame(width: 36, height: 42) }.accessibilityLabel(voice.recording ? "Stop recording" : "Dictate a question")
                            TextField("Ask WaySignal…", text: $draft, axis: .vertical).lineLimit(1...5).padding(11).background(.white, in: RoundedRectangle(cornerRadius: 14))
                            Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 34)) }.disabled(busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 1500).accessibilityLabel("Send question")
                        }
                        if draft.count > 1500 { Text("Keep your question under 1,500 characters.").font(.caption).foregroundStyle(.red) }
                    }.padding(14).background(.regularMaterial)
                }
        }.navigationTitle("WaySignal Guide").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle("Read new replies aloud", isOn: $readAloud)
                        Button("Stop audio") { voice.stopSpeaking() }
                        Button("New conversation") { messages = []; error = nil; voice.stopSpeaking() }.disabled(busy)
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .task { await assistance.load(); await community.load(); consumePrompt() }
            .onChange(of: navigation.guidePrompt) { _, _ in consumePrompt() }
            .onChange(of: voice.transcript) { _, text in draft = text }
            .onDisappear { voice.stop(); voice.stopSpeaking() }
    }
    private func consumePrompt() { if let prompt = navigation.guidePrompt { draft = prompt; navigation.guidePrompt = nil } }
    private func send() async {
        guard !busy, let client = session.client else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines); guard !text.isEmpty, text.count <= 1500 else { return }
        voice.stop(); busy = true; error = nil
        let history = messages.suffix(10).map { ChatHistory(role: $0.role, text: String($0.text.prefix(6000))) }
        let geometry = journey.assessment?.selected?.geometry.compactMap { $0.count == 2 ? Coordinate(latitude: $0[0], longitude: $0[1]) : nil }
        messages.append(.init(role: "user", text: text)); draft = ""
        defer { busy = false }
        do {
            let response: GuideResponse = try await client.request("mobile/assistant", method: "POST", body: Wire.encode(ChatInput(message: text, route: journey.input, routeGeometry: geometry, location: journey.origin, requestId: nil, history: history)))
            messages.append(.init(role: "assistant", text: response.text, response: response))
            if readAloud { voice.speak(response.text) }
        } catch { self.error = error.localizedDescription; draft = text }
    }
}
extension GuideSource { var sourceKey: String { kind + ":" + id } }
struct SourceDetailView: View {
    @EnvironmentObject private var context: ContextStore
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
            } else if source.kind == "conditions", let conditions = context.conditions {
                ConditionsCard(conditions: conditions)
            } else if source.kind == "facility", let place = context.places?.facilities.first(where: { $0.id == source.id }) {
                Text(place.name); Text("Availability and shelter clearance unverified.")
            } else { Text("Refreshing this source. If it remains unavailable, return to Community or Help and refresh.") }
            ErrorNotice(message: source.kind == "report" ? community.error : assistance.error)
        }.navigationTitle("Source details").task {
            if source.kind == "report" { await community.load() } else if source.kind == "assistance" { await assistance.load() }
        }
    }
}
