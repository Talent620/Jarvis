import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @EnvironmentObject var assistant: Assistant
    @State private var name = ""
    @State private var confirmWipe = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                // Identity
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Tożsamość", subtitle: "Jak ma się do Ciebie zwracać JARVIS")
                    HUDField(placeholder: "Twoje imię", text: $name, icon: "person.fill")
                    HUDButton(title: "Zapamiętaj imię", icon: "checkmark") {
                        store.userName = name.trimmingCharacters(in: .whitespaces).capitalizedFirst
                    }
                    if !store.userName.isEmpty {
                        Text("Zapamiętane imię: \(store.userName)")
                            .font(Theme.ui(13)).foregroundStyle(Theme.green)
                    }
                }
                .padding(16).hudPanel()

                // Voice
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Sterowanie głosowe")
                    Toggle(isOn: $store.voiceEnabled) {
                        Text("Mowa JARVIS (TTS)").font(Theme.ui(15)).foregroundStyle(Theme.textPrimary)
                    }
                    .tint(Theme.cyan)
                    HUDButton(title: "Test głosu", icon: "speaker.wave.2.fill") {
                        assistant.speech.speak("Systemy w pełni operacyjne. Jestem do usług.")
                    }
                }
                .padding(16).hudPanel()

                // Memory stats
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Pamięć")
                    statRow("Zadania", store.tasks.count)
                    statRow("Notatki", store.notes.count)
                    statRow("Przypomnienia", store.reminders.count)
                    statRow("Wydarzenia", store.events.count)
                    statRow("Zakupy", store.shopping.count)
                    statRow("Wpisy dziennika", store.journal.count)
                }
                .padding(16).hudPanel()

                // Danger zone
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Strefa zagrożenia")
                    Button(role: .destructive) { confirmWipe = true } label: {
                        HStack { Image(systemName: "trash.fill"); Text("Wyczyść wszystkie dane") }
                            .font(Theme.ui(15, weight: .semibold))
                            .foregroundStyle(Color(red: 1, green: 0.42, blue: 0.42))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(RoundedRectangle(cornerRadius: 14).stroke(Color(red: 1, green: 0.42, blue: 0.42).opacity(0.5), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(16).hudPanel()

                Text("JARVIS · net.serwer256.jarvis · v1.0")
                    .font(Theme.display(9)).foregroundStyle(Theme.textSecondary)
                    .padding(.top, 4)
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Ustawienia")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { name = store.userName }
        .alert("Wyczyścić całą pamięć?", isPresented: $confirmWipe) {
            Button("Anuluj", role: .cancel) {}
            Button("Wyczyść", role: .destructive) { store.wipeAll() }
        } message: {
            Text("Ta operacja usunie wszystkie zadania, notatki, przypomnienia, wydarzenia i zakupy.")
        }
    }

    private func statRow(_ label: String, _ value: Int) -> some View {
        HStack {
            Text(label).font(Theme.ui(14)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text("\(value)").font(Theme.display(15, weight: .bold)).foregroundStyle(Theme.cyan)
        }
    }
}
