import Foundation
import Combine
import Speech
import AVFoundation

@MainActor final class VoiceService: NSObject, ObservableObject {
    @Published var transcript = ""; @Published var recording = false; @Published var error: String?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    private let speaker = AVSpeechSynthesizer()
    func start() async {
        guard !recording else { return }; error = nil; speaker.stopSpeaking(at: .immediate)
        let speech = await withCheckedContinuation { continuation in SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) } }
        let microphone = await withCheckedContinuation { continuation in AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) } }
        guard speech == .authorized, microphone else { error = "Enable microphone and speech access in Settings, or type your question."; return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else { error = "Voice input is unavailable. You can type instead."; return }
        do {
            let session = AVAudioSession.sharedInstance(); try session.setCategory(.record, mode: .measurement, options: .duckOthers); try session.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true; self.request = request
            let input = engine.inputNode; let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw APIError(message: "No microphone is available.") }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }; tapInstalled = true
            transcript = ""; recording = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor in
                    if let result { self?.transcript = result.bestTranscription.formattedString }
                    if result?.isFinal == true || failure != nil { self?.stop() }
                }
            }
            engine.prepare(); try engine.start()
        } catch { stop(); self.error = error.localizedDescription }
    }
    func stop() {
        engine.stop(); if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        request?.endAudio(); task?.cancel(); task = nil; request = nil; recording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    func speak(_ text: String) {
        stop(); speaker.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: text); utterance.rate = AVSpeechUtteranceDefaultSpeechRate; speaker.speak(utterance)
    }
    func stopSpeaking() { speaker.stopSpeaking(at: .immediate) }
}
