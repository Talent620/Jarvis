import SwiftUI

/// "Dziennik" — mood-tagged journal entries.
struct JournalView: View {
    @EnvironmentObject var store: AppStore
    @State private var showEditor = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                moodStrip
                HUDButton(title: "Nowy wpis", icon: "square.and.pencil") { showEditor = true }

                if store.journal.isEmpty {
                    EmptyHint(icon: "book.closed", text: "Dziennik jest pusty. Zapisz pierwszą myśl.")
                } else {
                    ForEach(store.journal) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Circle().fill(entry.mood.color).frame(width: 10, height: 10)
                                Text(entry.title.isEmpty ? "Wpis" : entry.title)
                                    .font(Theme.ui(16, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                Button { store.journal.removeAll { $0.id == entry.id } } label: {
                                    Image(systemName: "trash").foregroundStyle(Theme.textSecondary)
                                }
                                .buttonStyle(.plain)
                            }
                            if !entry.body.isEmpty {
                                Text(entry.body).font(Theme.ui(14)).foregroundStyle(Theme.textSecondary)
                            }
                            HStack(spacing: 8) {
                                Text(entry.mood.label.uppercased())
                                    .font(Theme.display(9, weight: .bold)).tracking(1.5)
                                    .foregroundStyle(entry.mood.color)
                                Text("·").foregroundStyle(Theme.textSecondary)
                                Text(entry.createdAt, format: .dateTime.day().month().hour().minute())
                                    .font(Theme.display(9)).foregroundStyle(Theme.textSecondary)
                            }
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
        .navigationTitle("Dziennik")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showEditor) { JournalEditor() }
    }

    /// Quick mood histogram across all entries.
    private var moodStrip: some View {
        let counts = Dictionary(grouping: store.journal, by: \.mood).mapValues(\.count)
        return VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Nastroje", subtitle: "Rozkład wpisów w dzienniku")
            HStack(spacing: 4) {
                ForEach(Mood.allCases, id: \.self) { mood in
                    let c = counts[mood] ?? 0
                    Rectangle()
                        .fill(mood.color.opacity(c == 0 ? 0.12 : 0.9))
                        .frame(height: 8)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            if c > 0 { Text("\(c)").font(Theme.display(8)).foregroundStyle(mood.color).offset(y: -12) }
                        }
                }
            }
            .padding(.top, 14)
            Text("Wpisów: \(store.journal.count)").font(Theme.ui(11)).foregroundStyle(Theme.textSecondary)
        }
        .padding(16)
        .hudPanel()
    }
}

private struct JournalEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) var dismiss
    @State private var title = ""
    @State private var body_ = ""
    @State private var mood: Mood = .calm

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    HUDField(placeholder: "Tytuł rozdziału / dnia (opcjonalnie)", text: $title, icon: "textformat")
                    ZStack(alignment: .topLeading) {
                        if body_.isEmpty {
                            Text("Co czujesz, co się wydarzyło…")
                                .foregroundStyle(Theme.textSecondary).padding(16)
                        }
                        TextEditor(text: $body_)
                            .scrollContentBackground(.hidden)
                            .foregroundStyle(Theme.textPrimary)
                            .frame(minHeight: 200).padding(8)
                    }
                    .hudPanel()

                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeader(title: "Nastrój")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                            ForEach(Mood.allCases, id: \.self) { m in
                                Button { mood = m; Haptics.select() } label: {
                                    Text(m.label)
                                        .font(Theme.ui(13, weight: .semibold))
                                        .foregroundStyle(mood == m ? Theme.background : m.color)
                                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                                        .background(RoundedRectangle(cornerRadius: 10).fill(mood == m ? m.color : m.color.opacity(0.14)))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    HUDButton(title: "Zapisz wpis", icon: "checkmark") {
                        store.addJournal(title.isEmpty ? body_.prefixTitle : title, body_, mood: mood)
                        store.mood = mood
                        Haptics.success()
                        dismiss()
                    }
                    .disabled(title.isEmpty && body_.isEmpty)
                }
                .padding(18)
            }
            .hudBackground()
            .navigationTitle("Nowy wpis")
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
