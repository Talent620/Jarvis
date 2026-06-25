import Foundation
import AVFoundation
import Speech

/// Handles voice: Polish text-to-speech (AVSpeechSynthesizer) and
/// on-device speech-to-text dictation (Speech framework).
@MainActor
final class SpeechManager: NSObject, ObservableObject {
    @Published var isListening = false
    @Published var isSpeaking = false
    @Published var transcript = ""
    @Published var authorized = false

    private let synth = AVSpeechSynthesizer()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "pl-PL"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let engine = AVAudioEngine()

    override init() {
        super.init()
        synth.delegate = self
    }

    // MARK: TTS

    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        configureSession(.playback)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "pl-PL")
        u.rate = 0.5
        u.pitchMultiplier = 1.0
        isSpeaking = true
        synth.speak(u)
    }

    func stopSpeaking() { synth.stopSpeaking(at: .immediate); isSpeaking = false }

    // MARK: Permissions

    func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioApplication.requestRecordPermission { mic in
                Task { @MainActor in
                    self.authorized = (status == .authorized) && mic
                    completion(self.authorized)
                }
            }
        }
    }

    // MARK: STT dictation

    /// Toggle dictation. `onFinal` fires with the final transcript when listening stops.
    func toggleListening(onFinal: @escaping (String) -> Void) {
        if isListening { stopListening(onFinal: onFinal) }
        else { requestAuthorization { ok in if ok { self.startListening() } } }
    }

    private func startListening() {
        guard let recognizer, recognizer.isAvailable else { return }
        transcript = ""
        configureSession(.record)

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req

        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.removeTap(onBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        engine.prepare()
        do { try engine.start() } catch { return }
        isListening = true

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result { Task { @MainActor in self.transcript = result.bestTranscription.formattedString } }
            if error != nil || (result?.isFinal ?? false) {
                Task { @MainActor in self.teardownEngine() }
            }
        }
    }

    private func stopListening(onFinal: @escaping (String) -> Void) {
        let final = transcript
        teardownEngine()
        if !final.isEmpty { onFinal(final) }
    }

    private func teardownEngine() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        request?.endAudio()
        task?.cancel()
        request = nil; task = nil
        isListening = false
    }

    private func configureSession(_ mode: SessionMode) {
        let session = AVAudioSession.sharedInstance()
        do {
            switch mode {
            case .record:
                try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            case .playback:
                try session.setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
            }
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { /* best-effort */ }
    }

    enum SessionMode { case record, playback }
}

extension SpeechManager: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in self.isSpeaking = false }
    }
    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) {
        Task { @MainActor in self.isSpeaking = false }
    }
}
