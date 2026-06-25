import SwiftUI

/// "Umysł" — full conversation view with JARVIS.
struct MindView: View {
    @EnvironmentObject var store: AppStore
    @EnvironmentObject var assistant: Assistant
    @State private var input = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(store.chat) { msg in
                            ChatBubble(message: msg).id(msg.id)
                        }
                    }
                    .padding(16)
                }
                .onChange(of: store.chat.count) {
                    if let last = store.chat.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }

            inputBar
        }
        .hudBackground()
        .navigationTitle("Umysł")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            HUDField(placeholder: "Napisz do JARVIS…", text: $input, icon: "text.bubble")
            Button {
                assistant.speech.toggleListening { final in input = final; send() }
            } label: {
                Image(systemName: assistant.speech.isListening ? "waveform" : "mic.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(assistant.speech.isListening ? Theme.background : Theme.cyan)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(assistant.speech.isListening ? Theme.cyan : Theme.surfaceHi))
            }
            .buttonStyle(.plain)
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.background)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(Theme.cyan))
            }
            .buttonStyle(.plain)
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty)
            .opacity(input.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
        }
        .padding(12)
        .background(Theme.surface.opacity(0.8))
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        assistant.handle(text, speak: true)
        input = ""
    }
}

struct ChatBubble: View {
    var message: ChatMessage
    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.role == .user ? "TY" : "JARVIS")
                    .font(Theme.display(9, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(message.role == .user ? Theme.textSecondary : Theme.cyan)
                Text(message.text)
                    .font(Theme.ui(15))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(message.role == .user ? Theme.surfaceHi : Theme.cyan.opacity(0.12))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(message.role == .user ? Color.clear : Theme.cyan.opacity(0.3), lineWidth: 1)
                    )
            }
            if message.role == .jarvis { Spacer(minLength: 40) }
        }
    }
}
