import SwiftUI

struct CalendarModuleView: View {
    @EnvironmentObject var store: AppStore
    @State private var title = ""
    @State private var date = Date().addingTimeInterval(86400)

    private var grouped: [(String, [CalendarEvent])] {
        let cal = Calendar(identifier: .gregorian)
        let dict = Dictionary(grouping: store.events.sorted { $0.date < $1.date }) {
            cal.startOfDay(for: $0.date)
        }
        return dict.keys.sorted().map { (Assistant.dateFmt.string(from: $0), dict[$0] ?? []) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 12) {
                    HUDField(placeholder: "Tytuł wydarzenia", text: $title, icon: "calendar.badge.plus")
                    DatePicker("Kiedy", selection: $date)
                        .datePickerStyle(.compact)
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.cyan)
                    HUDButton(title: "Dodaj wydarzenie", icon: "plus") { add() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(16)
                .hudPanel()

                if store.events.isEmpty {
                    EmptyHint(icon: "calendar", text: "Brak zaplanowanych wydarzeń.")
                } else {
                    ForEach(grouped, id: \.0) { day, events in
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeader(title: day)
                            ForEach(events) { e in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(e.title).font(Theme.ui(15, weight: .semibold))
                                            .foregroundStyle(Theme.textPrimary)
                                        Text(e.date, style: .time).font(Theme.ui(12))
                                            .foregroundStyle(Theme.cyan)
                                    }
                                    Spacer()
                                    Button { store.events.removeAll { $0.id == e.id } } label: {
                                        Image(systemName: "xmark").foregroundStyle(Theme.textSecondary)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(14)
                                .hudPanel()
                            }
                        }
                    }
                }
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Kalendarz")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func add() {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        store.addEvent(t, at: date); title = ""
    }
}
