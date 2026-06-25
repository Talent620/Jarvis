import SwiftUI

struct RemindersView: View {
    @EnvironmentObject var store: AppStore
    @State private var text = ""
    @State private var date = Date().addingTimeInterval(3600)

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 12) {
                    HUDField(placeholder: "O czym przypomnieć?", text: $text, icon: "bell")
                    DatePicker("Termin", selection: $date)
                        .datePickerStyle(.compact)
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.cyan)
                    HUDButton(title: "Ustaw przypomnienie", icon: "plus") { add() }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(16)
                .hudPanel()

                if store.reminders.isEmpty {
                    EmptyHint(icon: "bell.slash", text: "Brak aktywnych przypomnień.")
                } else {
                    ForEach(store.reminders) { r in
                        CheckRow(text: r.text, done: r.done,
                                 detail: Assistant.dateTimeFmt.string(from: r.date),
                                 onToggle: { store.toggleReminder(r) },
                                 onDelete: { store.deleteReminder(r) })
                    }
                }
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Przypomnienia")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func add() {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        store.addReminder(t, at: date); text = ""
    }
}
