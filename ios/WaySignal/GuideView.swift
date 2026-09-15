import SwiftUI
import PhotosUI
import UIKit

struct GuideView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var assistance: AssistanceStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var navigation: AppNavigation
    @StateObject private var voice = VoiceService()
    @State private var messages: [ConversationMessage] = []
    @State private var draft = ""; @State private var busy = false; @State private var error: String?
    @State private var readAloud = true
    @State private var photoItem: PhotosPickerItem?
    @State private var screenshot: PreparedScreenshot?
    @State private var photoBusy = false
    @State private var showReport = false
    @State private var showVoiceHelp = false
    private let suggestions = ["Find a route to an open shelter", "Explain my route", "Rain and river forecast", "Find nearby facilities", "Summarize community reports", "Check my assistance requests", "How do I use WaySignal?"]
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
                            Text(message.role == "user" ? "YOU" : message.response?.mode == "ai_grounded" ? "NAV AI" : message.response?.mode == "app_help" ? "APP HELP" : "SOURCE SUMMARY").font(.caption2.bold()).tracking(1).foregroundStyle(message.role == "user" ? .white.opacity(0.8) : SignalStyle.gold)
                            if let data = message.imageData, let image = UIImage(data: data) {
                                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            Text(message.text).textSelection(.enabled)
                            if let response = message.response {
                                if !response.sources.isEmpty {
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack {
                                            ForEach(response.sources, id: \.sourceKey) { source in
                                                NavigationLink { SourceDetailView(source: source) } label: { Label(SignalCopy.recordID(source.id), systemImage: "link").font(.caption).padding(9).background(SignalStyle.background, in: Capsule()) }
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
                    if voice.error != nil {
                        HStack {
                            Button("Voice settings") { showVoiceHelp = true }
                            Spacer()
                            Button("Try microphone") { Task { await voice.start() } }.disabled(voice.starting || busy)
                        }.font(.subheadline.bold())
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }.padding(20)
            }.background(SignalStyle.background)
                .onChange(of: messages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .safeAreaInset(edge: .bottom) {
                    composer
                }

        }.navigationTitle("Nav AI").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { NavigationLink { EmergencyContactsView() } label: { Image(systemName: "phone.fill") }.accessibilityLabel("Emergency contacts") }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Toggle("Read new replies aloud", isOn: $readAloud)
                        Button("Voice settings") { showVoiceHelp = true }
                        Button("Stop audio") { voice.stopSpeaking() }
                        Button("New conversation") { messages = []; error = nil; voice.error = nil; screenshot = nil; photoItem = nil; voice.stop(); voice.stopSpeaking() }.disabled(busy)
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .sheet(isPresented: $showReport) { ReportForm() }
            .sheet(isPresented: $showVoiceHelp) { voiceHelp }
            .task(id: photoItem) {
                guard let item = photoItem else { return }
                photoBusy = true; error = nil
                defer { photoBusy = false }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { throw APIError(message: "This image could not be opened.") }
                    let prepared = try await Task.detached(priority: .userInitiated) { try ScreenshotReader.prepare(data) }.value
                    try Task.checkCancellation()
                    screenshot = prepared
                } catch is CancellationError { } catch { self.error = error.localizedDescription }
            }
            .task { await assistance.load(); await community.load(); consumePrompt() }
            .onChange(of: navigation.guidePrompt) { _, _ in consumePrompt() }
            .onChange(of: voice.transcript) { _, text in if voice.recording || !text.isEmpty { draft = text } }
            .onDisappear { voice.stop(); voice.stopSpeaking() }
    }
    private var composer: some View {
        VStack(spacing: 10) {
            HStack {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label("Ask about a picture", systemImage: "photo.badge.plus")
                }.disabled(busy || photoBusy || voice.starting)
                Spacer()
                Button { voice.stop(); showReport = true } label: { Label("Report hazard", systemImage: "mappin.and.ellipse") }.disabled(busy)
            }.font(.caption.bold())
            if photoBusy { ProgressView("Reading picture text…").font(.caption) }
            if let screenshot, let image = UIImage(data: screenshot.jpeg) {
                HStack(spacing: 10) {
                    Image(uiImage: image).resizable().scaledToFit().frame(width: 50, height: 60)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Picture attached").font(.caption.bold())
                        Text("Sent with your question. Not posted to the map.").font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { self.screenshot = nil; photoItem = nil } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("Remove picture").disabled(busy)
                }
            }
            if voice.starting { ProgressView("Opening microphone…").font(.caption) }
            if voice.recording { Text("Listening… Tap stop, review your words, then send.").font(.caption).foregroundStyle(.secondary) }
            HStack(alignment: .bottom, spacing: 10) {
                Button { if voice.recording { voice.stop() } else { Task { await voice.start() } } } label: {
                    Image(systemName: voice.recording ? "stop.circle.fill" : "mic.fill").font(.title3).frame(width: 36, height: 44)
                }.disabled(voice.starting || busy).accessibilityLabel(voice.recording ? "Stop recording" : "Dictate a question")
                TextField("Ask Nav AI…", text: $draft, axis: .vertical).lineLimit(1...4).padding(11).background(.white, in: RoundedRectangle(cornerRadius: 14)).disabled(busy)
                Button { Task { await send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 34)) }
                    .disabled(busy || photoBusy || voice.starting || (draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && screenshot == nil) || draft.count > 1500).accessibilityLabel("Send question")
            }
            HStack {
                Button { readAloud.toggle(); if !readAloud { voice.stopSpeaking() } } label: {
                    Label(readAloud ? "Read replies aloud: on" : "Read replies aloud: off", systemImage: readAloud ? "speaker.wave.2" : "speaker.slash")
                }
                Spacer()
                Button("Voice setup") { showVoiceHelp = true }
            }.font(.caption2)
            if draft.count > 1500 { Text("Keep your question under 1,500 characters.").font(.caption).foregroundStyle(.red) }
        }.padding(14).background(.regularMaterial)
    }
    private var voiceHelp: some View {
        NavigationStack {
            Form {
                Section("Speak a question") {
                    Text("Tap Try microphone and allow both Microphone and Speech Recognition. Speak, tap stop, review the words, and send.")
                    ErrorNotice(message: voice.error)
                    Button(voice.recording ? "Stop microphone" : "Try microphone") {
                        if voice.recording { voice.stop() } else { Task { await voice.start() } }
                    }.disabled(voice.starting || busy)
                    if voice.recording { Text("Listening: " + (voice.transcript.isEmpty ? "Say a few words…" : voice.transcript)) }
                    if voice.needsSettings {
                        Button("Open WaySignal Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                    #if targetEnvironment(simulator)
                    Text("On your Mac, also open System Settings → Privacy & Security → Microphone and allow Device Hub or Simulator. The Mac microphone supplies the simulator's audio.").font(.footnote)
                    #endif
                }
                Section("Hear an answer") {
                    Toggle("Read replies aloud", isOn: $readAloud)
                    Button("Test speaker") { voice.speak("Nav AI is ready. Ask about your route, upload a screenshot, or report a hazard for your community.") }
                    Button("Stop audio") { voice.stopSpeaking() }
                    Text("You can type any question and hear the answer even when microphone access is unavailable.").font(.footnote)
                }
            }.navigationTitle("Voice setup").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showVoiceHelp = false } } }
        }
    }
    private func consumePrompt() { if let prompt = navigation.guidePrompt { draft = prompt; navigation.guidePrompt = nil } }
    private func send() async {
        guard !busy, let client = session.client else { return }
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachment = screenshot
        let text = question.isEmpty && attachment != nil ? "Help me understand this picture and what to do in WaySignal." : question
        guard !text.isEmpty, text.count <= 1500, !photoBusy else { return }
        voice.stop(); busy = true; error = nil
        let history = messages.suffix(10).map { ChatHistory(role: $0.role, text: String($0.text.prefix(6000))) }
        let geometry = journey.assessment?.selected?.geometry.compactMap { $0.count == 2 ? Coordinate(latitude: $0[0], longitude: $0[1]) : nil }
        messages.append(.init(role: "user", text: text, imageData: attachment?.jpeg)); draft = ""
        defer { busy = false }
        do {
            let response: GuideResponse = try await client.request("mobile/assistant", method: "POST", body: Wire.encode(ChatInput(message: text, route: journey.input, routeGeometry: geometry, location: journey.origin, requestId: nil, history: history, imageBase64: attachment?.jpeg.base64EncodedString(), imageText: attachment?.text)))
            messages.append(.init(role: "assistant", text: response.text, response: response))
            screenshot = nil; photoItem = nil
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
            Section("Source record") { Text(SignalCopy.recordID(source.id)).font(.caption.monospaced()).textSelection(.enabled) }
            if source.kind == "report", let report = community.reports.first(where: { $0.id == source.id }) {
                Section(report.label) {
                    StatusPill(state: report.reviewState)
                    Text("\(report.latitude), \(report.longitude)")
                    Text("Updated \(Wire.date(report.updatedAt))")
                    if !report.reviewNote.isEmpty { Text(SignalCopy.review(report.reviewNote, id: report.id)) }
                }
            } else if source.kind == "assistance", let request = assistance.requests.first(where: { $0.id == source.id }) {
                Section("Assistance") {
                    StatusPill(state: request.status)
                    Text("Updated \(Wire.date(request.updatedAt ?? request.createdAt))")
                    if let name = request.responderName { Text("Responder: \(name)") }
                }
            } else if source.kind == "shelter", let site = community.mapState?.shelters.first(where: { $0.id == source.id }) {
                Section(site.name) {
                    Text(site.available ? "Recorded open" : site.status.replacingOccurrences(of: "_", with: " "))
                    Text(site.note); Text(site.source)
                    Text("Checked \(Wire.date(site.checkedAt))").font(.caption)
                    Text("Expires \(Wire.date(site.expiresAt))").font(.caption)
                }
            } else if source.kind == "conditions", let conditions = context.conditions {
                ConditionsCard(conditions: conditions)
            } else if source.kind == "facility", let place = context.places?.facilities.first(where: { $0.id == source.id }) {
                Text(place.name); Text("Availability and shelter clearance unverified.")
            } else { Text("Refreshing this source. If it remains unavailable, return to Community or Help and refresh.") }
            ErrorNotice(message: source.kind == "report" ? community.error : assistance.error)
        }.navigationTitle("Source details").task {
            if source.kind == "report" || source.kind == "shelter" { await community.load() } else if source.kind == "assistance" { await assistance.load() }
        }
    }
}
