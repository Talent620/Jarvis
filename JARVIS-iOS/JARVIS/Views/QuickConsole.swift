import SwiftUI

/// Compact command bar on the home HUD: type a command or hold the mic to dictate.
struct QuickConsole: View {
    @EnvironmentObject var store: AppStore
    @EnvironmentObject var assistant: Assistant
    @State private var input = ""

    var body: some View {
        VStack(spacing: 12) {
            SectionHeader(title: "Sterowanie", subtitle: "Wpisz polecenie lub użyj głosu")
            HStack(spacing: 10) {
                HUDField(placeholder: "Powiedz, czego potrzebujesz…", text: $input, icon: "terminal")
                micButton
            }
            HUDButton(title: "Wyślij", icon: "paperplane.fill") { send() }
                .opacity(input.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(16)
        .hudPanel()
    }

    private var micButton: some View {
        Button {
            assistant.speech.toggleListening { final in
                input = final
                send()
            }
        } label: {
            Image(systemName: assistant.speech.isListening ? "waveform" : "mic.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(assistant.speech.isListening ? Theme.background : Theme.cyan)
                .frame(width: 50, height: 50)
                .background(
                    Circle().fill(assistant.speech.isListening ? Theme.cyan : Theme.surfaceHi)
                )
                .overlay(Circle().stroke(Theme.cyan.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        assistant.handle(text, speak: true)
        input = ""
    }
}
