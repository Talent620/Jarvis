import SwiftUI

struct TasksView: View {
    @EnvironmentObject var store: AppStore
    @State private var newTask = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack(spacing: 10) {
                    HUDField(placeholder: "Dodaj zadanie…", text: $newTask, icon: "plus")
                    Button(action: add) {
                        Image(systemName: "plus")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.background)
                            .frame(width: 50, height: 50)
                            .background(Circle().fill(Theme.cyan))
                    }
                    .buttonStyle(.plain)
                }

                if store.tasks.isEmpty {
                    EmptyHint(icon: "checklist", text: "Brak zadań. Dodaj pierwsze powyżej.")
                } else {
                    ForEach(store.tasks) { t in
                        CheckRow(text: t.title, done: t.done,
                                 detail: nil,
                                 onToggle: { store.toggleTask(t) },
                                 onDelete: { store.tasks.removeAll { $0.id == t.id } })
                    }
                }
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Zadania")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func add() {
        let t = newTask.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        store.addTask(t); newTask = ""
    }
}
