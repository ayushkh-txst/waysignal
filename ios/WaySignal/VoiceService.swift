import Foundation
import Combine
import Speech
import AVFoundation

@MainActor final class VoiceService: NSObject, ObservableObject {
    @Published var transcript = ""
    @Published var recording = false
    @Published var starting = false
    @Published var error: String?
    @Published var needsSettings = false
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private var generation = UUID()
    private let speaker = AVSpeechSynthesizer()

    func start() async {
        guard !recording, !starting else { return }
        starting = true; error = nil; needsSettings = false
        speaker.stopSpeaking(at: .immediate)
        let attempt = UUID(); generation = attempt
        defer { if generation == attempt { starting = false } }
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard generation == attempt else { return }
        let microphone = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard generation == attempt else { return }
        guard speech == .authorized, microphone else {
            needsSettings = true
            if speech == .restricted { error = "Speech recognition is restricted on this device. You can type a question and hear the answer." }
            else if !microphone && speech != .authorized { error = "Allow Microphone and Speech Recognition for WaySignal in Settings, then tap Try microphone." }
            else if !microphone { error = "Microphone access is off. Enable Microphone for WaySignal in Settings, then try again." }
            else { error = "Speech Recognition is off. Enable it for WaySignal in Settings, then try again." }
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            error = "Speech recognition is unavailable right now. Check your connection and try again, or type your question."; return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .duckOthers])
            try session.setActive(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw APIError(message: "No microphone is connected. On Mac, allow microphone access for Device Hub or Simulator in System Settings.")
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true; self.request = request
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
            tapInstalled = true; transcript = ""; recording = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor in
                    guard let self, self.generation == attempt else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if result?.isFinal == true || failure != nil {
                        if failure != nil && self.transcript.isEmpty {
                            self.error = "No speech was captured. Check the microphone, then try again. You can also type and use Read replies aloud."
                        }
                        self.stop()
                    }
                }
            }
            engine.prepare(); try engine.start()
        } catch { stop(); self.error = error.localizedDescription }
    }
    func stop() {
        generation = UUID(); starting = false
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); task?.cancel(); task = nil; request = nil; recording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    func speak(_ text: String) {
        stop(); speaker.stopSpeaking(at: .immediate)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            try AVAudioSession.sharedInstance().setActive(true)
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            speaker.speak(utterance)
        } catch { self.error = "Audio playback could not start. Check your speaker or headphones and try again." }
    }
    func stopSpeaking() {
        speaker.stopSpeaking(at: .immediate)
        if !recording { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
}
