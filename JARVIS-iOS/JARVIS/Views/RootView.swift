import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: AppStore
    @EnvironmentObject var assistant: Assistant
    @State private var route: Module?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    statusBar
                    coreSection
                    QuickConsole()
                    moduleGrid
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
            .hudBackground()
            .navigationDestination(item: $route) { module in
                destination(for: module)
            }
        }
    }

    // MARK: Top status

    private var statusBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("J.A.R.V.I.S")
                    .font(Theme.display(20, weight: .black))
                    .tracking(4)
                    .foregroundStyle(Theme.cyan)
                Text("AI ASSISTANT · v1.0")
                    .font(Theme.display(9, weight: .semibold))
                    .tracking(3)
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(Theme.green).frame(width: 8, height: 8)
                Text("ONLINE").font(Theme.display(10, weight: .bold)).foregroundStyle(Theme.green)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Capsule().stroke(Theme.green.opacity(0.4), lineWidth: 1))
        }
        .padding(.top, 8)
    }

    // MARK: Core

    private var coreSection: some View {
        VStack(spacing: 14) {
            CoreView(mood: store.mood,
                     active: assistant.speech.isListening || assistant.speech.isSpeaking)
                .padding(.top, 6)

            VStack(spacing: 4) {
                Text(coreStatusText)
                    .font(Theme.ui(15, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .animation(.easeInOut, value: coreStatusText)
                Text("Nastrój rdzenia: \(store.mood.label)")
                    .font(Theme.ui(12))
                    .foregroundStyle(store.mood.color.opacity(0.9))
            }
        }
    }

    private var coreStatusText: String {
        if assistant.speech.isListening { return "Słucham…" }
        if assistant.speech.isSpeaking  { return "Mówię…" }
        if !assistant.lastReply.isEmpty { return assistant.lastReply }
        let who = store.userName.isEmpty ? "" : ", \(store.userName)"
        return "Witaj\(who). W czym mogę pomóc?"
    }

    // MARK: Module grid

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    private var moduleGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Nawigacja modułów")
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(Module.allCases) { m in
                    ModuleTile(module: m, badge: badge(for: m)) { route = m }
                }
            }
        }
    }

    private func badge(for m: Module) -> Int {
        switch m {
        case .tasks:     return store.tasks.filter { !$0.done }.count
        case .notes:     return store.notes.count
        case .reminders: return store.reminders.filter { !$0.done }.count
        case .shopping:  return store.shopping.filter { !$0.bought }.count
        case .calendar:  return store.events.count
        default:         return 0
        }
    }

    // MARK: Routing

    @ViewBuilder
    private func destination(for module: Module) -> some View {
        switch module {
        case .mind:      MindView()
        case .tasks:     TasksView()
        case .notes:     NotesView()
        case .reminders: RemindersView()
        case .calendar:  CalendarModuleView()
        case .shopping:  ShoppingView()
        case .settings:  SettingsView()
        }
    }
}

/// One tile in the module navigation grid.
struct ModuleTile: View {
    var module: Module
    var badge: Int
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Image(systemName: module.icon)
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Theme.cyan)
                    Spacer()
                    if badge > 0 {
                        Text("\(badge)")
                            .font(Theme.display(11, weight: .bold))
                            .foregroundStyle(Theme.background)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(Circle().fill(Theme.cyan))
                    }
                }
                Text(module.title)
                    .font(Theme.ui(16, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 96)
            .padding(16)
            .hudPanel()
        }
        .buttonStyle(.plain)
    }
}
