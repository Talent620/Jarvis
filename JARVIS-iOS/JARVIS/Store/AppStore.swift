import SwiftUI
import Combine

/// Single source of truth for all JARVIS data, persisted to UserDefaults as JSON.
@MainActor
final class AppStore: ObservableObject {
    @Published var tasks: [TaskItem] = []        { didSet { persist(tasks, "jarvis.tasks") } }
    @Published var notes: [Note] = []            { didSet { persist(notes, "jarvis.notes") } }
    @Published var reminders: [Reminder] = []    { didSet { persist(reminders, "jarvis.reminders") } }
    @Published var shopping: [ShoppingItem] = [] { didSet { persist(shopping, "jarvis.shopping") } }
    @Published var events: [CalendarEvent] = []  { didSet { persist(events, "jarvis.events") } }
    @Published var journal: [JournalEntry] = []  { didSet { persist(journal, "jarvis.journal") } }
    @Published var chat: [ChatMessage] = []      { didSet { persist(chat, "jarvis.chat") } }

    @Published var userName: String = UserDefaults.standard.string(forKey: "jarvis.userName") ?? "" {
        didSet { UserDefaults.standard.set(userName, forKey: "jarvis.userName") }
    }
    @Published var voiceEnabled: Bool = UserDefaults.standard.object(forKey: "jarvis.voice") as? Bool ?? true {
        didSet { UserDefaults.standard.set(voiceEnabled, forKey: "jarvis.voice") }
    }
    @Published var mood: Mood = .calm

    private let defaults = UserDefaults.standard
    private var loaded = false   // suppress persistence during initial load

    init() {
        tasks     = load("jarvis.tasks", [TaskItem].self) ?? []
        notes     = load("jarvis.notes", [Note].self) ?? []
        reminders = load("jarvis.reminders", [Reminder].self) ?? []
        shopping  = load("jarvis.shopping", [ShoppingItem].self) ?? []
        events    = load("jarvis.events", [CalendarEvent].self) ?? []
        journal   = load("jarvis.journal", [JournalEntry].self) ?? []
        chat      = load("jarvis.chat", [ChatMessage].self) ?? []
        if chat.isEmpty {
            chat = [ChatMessage(role: .jarvis, text: "Systemy online. W czym mogę pomóc?")]
        }
        loaded = true
        NotificationManager.shared.sync(reminders)
    }

    // MARK: Convenience mutations used by the assistant + UI

    func addTask(_ title: String)         { tasks.insert(TaskItem(title: title), at: 0) }
    func toggleTask(_ t: TaskItem)        { if let i = tasks.firstIndex(of: t) { tasks[i].done.toggle() } }
    func addNote(_ title: String, _ body: String) { notes.insert(Note(title: title, body: body), at: 0) }
    func addReminder(_ text: String, at date: Date) {
        let r = Reminder(text: text, date: date)
        reminders.append(r); reminders.sort { $0.date < $1.date }
        NotificationManager.shared.schedule(r)
    }
    func toggleReminder(_ r: Reminder) {
        guard let i = reminders.firstIndex(of: r) else { return }
        reminders[i].done.toggle()
        if reminders[i].done { NotificationManager.shared.cancel(r.id) }
        else { NotificationManager.shared.schedule(reminders[i]) }
    }
    func deleteReminder(_ r: Reminder) {
        NotificationManager.shared.cancel(r.id)
        reminders.removeAll { $0.id == r.id }
    }
    func addShopping(_ name: String)      { shopping.insert(ShoppingItem(name: name), at: 0) }
    func toggleShopping(_ s: ShoppingItem){ if let i = shopping.firstIndex(of: s) { shopping[i].bought.toggle() } }
    func addEvent(_ title: String, at date: Date) { events.append(CalendarEvent(title: title, date: date)); events.sort { $0.date < $1.date } }
    func addJournal(_ title: String, _ body: String, mood: Mood) { journal.insert(JournalEntry(title: title, body: body, mood: mood), at: 0) }
    func appendChat(_ m: ChatMessage)     { chat.append(m) }

    func wipeAll() {
        for r in reminders { NotificationManager.shared.cancel(r.id) }
        tasks = []; notes = []; reminders = []; shopping = []; events = []; journal = []
        chat = [ChatMessage(role: .jarvis, text: "Pamięć wyczyszczona. Zaczynamy od nowa.")]
    }

    // MARK: Persistence helpers

    private func persist<T: Encodable>(_ value: T, _ key: String) {
        guard loaded else { return }
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }

    private func load<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
