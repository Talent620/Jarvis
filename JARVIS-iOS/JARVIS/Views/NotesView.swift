import SwiftUI

struct NotesView: View {
    @EnvironmentObject var store: AppStore
    @State private var showEditor = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                HUDButton(title: "Nowa notatka", icon: "square.and.pencil") { showEditor = true }

                if store.notes.isEmpty {
                    EmptyHint(icon: "note.text", text: "Nie masz jeszcze żadnych notatek.")
                } else {
                    ForEach(store.notes) { note in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(note.title.isEmpty ? "Bez tytułu" : note.title)
                                    .font(Theme.ui(16, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Button {
                                    store.notes.removeAll { $0.id == note.id }
                                } label: {
                                    Image(systemName: "trash").foregroundStyle(Theme.textSecondary)
                                }
                                .buttonStyle(.plain)
                            }
                            if !note.body.isEmpty {
                                Text(note.body)
                                    .font(Theme.ui(14))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Text(note.createdAt, style: .date)
                                .font(Theme.display(9))
                                .foregroundStyle(Theme.textSecondary.opacity(0.7))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .hudPanel()
                    }
                }
            }
            .padding(18)
        }
        .hudBackground()
        .navigationTitle("Notatki")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showEditor) { NoteEditor() }
    }
}

private struct NoteEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) var dismiss
    @State private var title = ""
    @State private var body_ = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    HUDField(placeholder: "Tytuł wpisu", text: $title, icon: "textformat")
                    ZStack(alignment: .topLeading) {
                        if body_.isEmpty {
                            Text("Zapisz myśl, pomysł, fragment…")
                                .foregroundStyle(Theme.textSecondary)
                                .padding(16)
                        }
                        TextEditor(text: $body_)
                            .scrollContentBackground(.hidden)
                            .foregroundStyle(Theme.textPrimary)
                            .frame(minHeight: 220)
                            .padding(8)
                    }
                    .hudPanel()
                    HUDButton(title: "Zapisz notatkę", icon: "checkmark") {
                        store.addNote(title.isEmpty ? body_.prefixTitle : title, body_)
                        dismiss()
                    }
                    .disabled(title.isEmpty && body_.isEmpty)
                }
                .padding(18)
            }
            .hudBackground()
            .navigationTitle("Nowa notatka")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Anuluj") { dismiss() }.foregroundStyle(Theme.cyan)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
