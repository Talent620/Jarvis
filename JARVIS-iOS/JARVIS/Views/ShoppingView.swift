import SwiftUI

struct ShoppingView: View {
    @EnvironmentObject var store: AppStore
    @State private var item = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack(spacing: 10) {
                    HUDField(placeholder: "Pozycja na liście zakupów", text: $item, icon: "cart.badge.plus")
                    Button(action: add) {
                        Image(systemName: "plus")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.background)
                            .frame(width: 50, height: 50)
                            .background(Circle().fill(Theme.cyan))
                    }
                    .buttonStyle(.plain)
                }

                if store.shopping.isEmpty {
                    EmptyHint(icon: "cart", text: "Lista zakupów jest pusta.")
                } else {
                    ForEach(store.shopping) { s in
                        CheckRow(text: s.name, done: s.bought,
                                 onToggle: { store.toggleShopping(s) },
                                 onDelete: { store.shopping.removeAll { $0.id == s.id } })
                    }
                    HUDButton(title: "Wyczyść listę", icon: "trash") { store.shopping.removeAll() }
                        .padding(.top, 6)
                }
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Zakupy")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func add() {
        let t = item.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        store.addShopping(t); item = ""
    }
}
