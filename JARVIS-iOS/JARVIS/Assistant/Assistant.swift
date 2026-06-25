import SwiftUI
import Combine

/// JARVIS's "Umysł" — interprets Polish text/voice commands, mutates the store,
/// and produces spoken/written replies. A lightweight intent parser (no network).
@MainActor
final class Assistant: ObservableObject {
    @Published var isThinking = false
    @Published var lastReply: String = ""

    private weak var store: AppStore?
    let speech = SpeechManager()
    private var cancellables = Set<AnyCancellable>()

    init() {
        // Re-publish the speech manager's state so views observing `Assistant`
        // refresh when listening/speaking toggles.
        speech.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    func attach(store: AppStore) { self.store = store }

    // MARK: Public entry point

    /// Handle a user utterance: log it, parse intent, reply, optionally speak.
    func handle(_ raw: String, speak: Bool = false) {
        guard let store else { return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        store.appendChat(ChatMessage(role: .user, text: text))
        let reply = respond(to: text, store: store)
        store.appendChat(ChatMessage(role: .jarvis, text: reply))
        lastReply = reply
        store.mood = inferMood(from: text, reply: reply)

        if speak && store.voiceEnabled { speech.speak(reply) }
    }

    // MARK: Intent routing

    private func respond(to text: String, store: AppStore) -> String {
        let l = text.lowercased()

        // Greetings / identity
        if matches(l, ["cześć", "czesc", "hej", "witaj", "dzień dobry", "dzien dobry", "siema"]) {
            let who = store.userName.isEmpty ? "" : ", \(store.userName)"
            return "Witam ciepło\(who). Co dziś zrobimy?"
        }
        if matches(l, ["kim jesteś", "kim jestes", "przedstaw się", "przedstaw sie", "co potrafisz"]) {
            return "Jestem JARVIS — Twój asystent. Prowadzę zadania, notatki, przypomnienia, kalendarz i listę zakupów. Mów śmiało."
        }
        if matches(l, ["dziękuję", "dziekuje", "dzięki", "dzieki"]) {
            return "Cała przyjemność po mojej stronie."
        }

        // Time / date
        if matches(l, ["która godzina", "ktora godzina", "jaki czas"]) {
            return "Jest \(Self.timeFmt.string(from: Date()))."
        }
        if matches(l, ["jaki dziś dzień", "jaki dzis dzien", "jaka data", "który dziś", "ktory dzis"]) {
            return "Dziś jest \(Self.dateFmt.string(from: Date()))."
        }

        // Tasks — "dodaj zadanie ...", "pokaż zadania"
        if let body = capture(l, after: ["dodaj zadanie", "nowe zadanie", "zadanie"]) {
            store.addTask(body.capitalizedFirst)
            return "Dodałem zadanie: „\(body)". Załatwione."
        }
        if matches(l, ["pokaż zadania", "pokaz zadania", "lista zadań", "lista zadan", "co mam do zrobienia"]) {
            return listSummary(store.tasks.filter { !$0.done }.map(\.title), empty: "Nie masz aktywnych zadań.", head: "Oto plan na dziś:")
        }
        if matches(l, ["wyczyść zadania", "wyczysc zadania"]) {
            store.tasks.removeAll(); return "Lista zadań wyczyszczona."
        }

        // Notes — "zanotuj ...", "nowa notatka ..."
        if let body = capture(l, after: ["zanotuj", "zapisz notatkę", "zapisz notatke", "notatka", "nowa notatka"]) {
            store.addNote(body.prefixTitle, body)
            return "Notuję: „\(body)". Zapisane do modułu Notatki."
        }

        // Reminders — "przypomnij mi ..."
        if let body = capture(l, after: ["przypomnij mi", "przypomnij", "ustaw przypomnienie"]) {
            let date = Self.parseDate(in: l) ?? Date().addingTimeInterval(3600)
            store.addReminder(body.capitalizedFirst, at: date)
            return "Przypomnę: „\(body)" — \(Self.dateTimeFmt.string(from: date))."
        }
        if matches(l, ["pokaż przypomnienia", "pokaz przypomnienia", "moje przypomnienia"]) {
            return listSummary(store.reminders.filter { !$0.done }.map { "\($0.text) — \(Self.dateTimeFmt.string(from: $0.date))" },
                               empty: "Brak aktywnych przypomnień.", head: "Twoje przypomnienia:")
        }

        // Shopping — "dodaj do listy zakupów ...", "kup ..."
        if let body = capture(l, after: ["dodaj do zakupów", "dodaj do zakupow", "dodaj do listy zakupów", "dodaj do listy zakupow", "kup", "na zakupy"]) {
            store.addShopping(body.capitalizedFirst)
            return "Dorzucam do listy zakupów: „\(body)"."
        }
        if matches(l, ["pokaż zakupy", "pokaz zakupy", "lista zakupów", "lista zakupow"]) {
            return listSummary(store.shopping.filter { !$0.bought }.map(\.name), empty: "Lista zakupów jest pusta.", head: "Na liście zakupów:")
        }

        // Calendar — "dodaj wydarzenie ..."
        if let body = capture(l, after: ["dodaj wydarzenie", "nowe wydarzenie", "zaplanuj"]) {
            let date = Self.parseDate(in: l) ?? Date().addingTimeInterval(86400)
            store.addEvent(body.capitalizedFirst, at: date)
            return "Zaplanowane: „\(body)" — \(Self.dateTimeFmt.string(from: date))."
        }

        // Simple maths — "ile to 12 razy 3"
        if let result = Self.evaluateMath(in: l) {
            return "To \(result)."
        }

        // Coin flip / choice
        if matches(l, ["rzuć monetą", "rzuc moneta", "orzeł czy reszka", "orzel czy reszka"]) {
            return Bool.random() ? "Orzeł." : "Reszka."
        }

        // Name memory — "mam na imię ..."
        if let name = capture(l, after: ["mam na imię", "mam na imie", "nazywam się", "nazywam sie"]) {
            store.userName = name.capitalizedFirst
            return "Miło Cię poznać, \(store.userName). Zapamiętałem."
        }

        // Fallback — conversational acknowledgement
        return fallback(for: text)
    }

    // MARK: Helpers

    private func matches(_ text: String, _ keys: [String]) -> Bool {
        keys.contains { text.contains($0) }
    }

    /// Returns the remainder of the string after the first matching trigger phrase.
    private func capture(_ text: String, after triggers: [String]) -> String? {
        for t in triggers {
            if let r = text.range(of: t) {
                let rest = text[r.upperBound...].trimmingCharacters(in: .whitespaces)
                // strip leading filler words
                let cleaned = rest.replacingOccurrences(of: "^(o |że |ze |aby )", with: "", options: .regularExpression)
                if !cleaned.isEmpty { return cleaned }
            }
        }
        return nil
    }

    private func listSummary(_ items: [String], empty: String, head: String) -> String {
        guard !items.isEmpty else { return empty }
        let body = items.prefix(8).enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n")
        let extra = items.count > 8 ? "\n…oraz \(items.count - 8) więcej." : ""
        return "\(head)\n\(body)\(extra)"
    }

    private func fallback(for text: String) -> String {
        let replies = [
            "Przyjąłem. Zajmę się tym.",
            "Rozumiem. Powiedz mi więcej, a podpowiem najlepszy ruch.",
            "Notuję w pamięci roboczej. Co dalej?",
            "Jestem do usług. Mogę dodać zadanie, notatkę albo przypomnienie."
        ]
        return replies.randomElement()!
    }

    private func inferMood(from text: String, reply: String) -> Mood {
        let l = text.lowercased()
        if matches(l, ["super", "świetnie", "swietnie", "dziękuję", "dziekuje", "rewelacja", "gratulacje"]) { return .happy }
        if matches(l, ["zmęczony", "zmeczony", "śpię", "spie", "wykończony", "wykonczony"]) { return .tired }
        if matches(l, ["stres", "spięty", "spiety", "napięcie", "napiecie", "nerwy"]) { return .tense }
        if matches(l, ["zły", "zly", "wkurzony", "wściekły", "wsciekly"]) { return .angry }
        if matches(l, ["zadanie", "plan", "skup", "praca", "deadline"]) { return .focused }
        if matches(l, ["marzę", "marze", "kiedyś", "kiedys", "wakacje"]) { return .dreamy }
        return .calm
    }

    // MARK: Formatters & parsers

    static let timeFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.dateFormat = "HH:mm"; return f
    }()
    static let dateFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.dateFormat = "EEEE, d MMMM yyyy"; return f
    }()
    static let dateTimeFmt: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.dateFormat = "d MMM, HH:mm"; return f
    }()

    /// Very small natural-time parser: "jutro", "za 2 godziny", "o 15", "o 15:30".
    static func parseDate(in text: String) -> Date? {
        let cal = Calendar(identifier: .gregorian)
        var base = Date()
        if text.contains("jutro") { base = cal.date(byAdding: .day, value: 1, to: base) ?? base }
        if text.contains("pojutrze") { base = cal.date(byAdding: .day, value: 2, to: base) ?? base }

        if let m = text.range(of: #"za (\d+) godzin"#, options: .regularExpression) {
            let n = Int(text[m].filter(\.isNumber)) ?? 1
            return cal.date(byAdding: .hour, value: n, to: Date())
        }
        if let m = text.range(of: #"za (\d+) minut"#, options: .regularExpression) {
            let n = Int(text[m].filter(\.isNumber)) ?? 1
            return cal.date(byAdding: .minute, value: n, to: Date())
        }
        if let m = text.range(of: #"o (\d{1,2})(:(\d{2}))?"#, options: .regularExpression) {
            let comps = text[m].dropFirst(2).split(separator: ":")
            let h = Int(comps.first.map(String.init)?.filter(\.isNumber) ?? "") ?? 9
            let mn = comps.count > 1 ? (Int(comps[1]) ?? 0) : 0
            return cal.date(bySettingHour: min(h, 23), minute: min(mn, 59), second: 0, of: base)
        }
        return text.contains("jutro") || text.contains("pojutrze") ? base : nil
    }

    /// Evaluate trivial "a razy/plus/minus/przez b" expressions.
    static func evaluateMath(in text: String) -> String? {
        let map: [(String, (Double, Double) -> Double)] = [
            ("razy", *), ("plus", +), ("minus", -), ("przez", /),
            ("*", *), ("+", +), ("-", -), ("/", /)
        ]
        for (op, fn) in map {
            let parts = text.components(separatedBy: op)
            guard parts.count == 2,
                  let a = firstNumber(in: parts[0]),
                  let b = firstNumber(in: parts[1]) else { continue }
            let r = fn(a, b)
            return r == r.rounded() ? String(Int(r)) : String(format: "%.2f", r)
        }
        return nil
    }

    private static func firstNumber(in s: String) -> Double? {
        let token = s.split(whereSeparator: { !($0.isNumber || $0 == "." || $0 == ",") })
            .last.map { $0.replacingOccurrences(of: ",", with: ".") }
        return token.flatMap(Double.init)
    }
}

// MARK: - Small string conveniences

extension String {
    var capitalizedFirst: String { isEmpty ? self : prefix(1).uppercased() + dropFirst() }
    var prefixTitle: String {
        let words = split(separator: " ").prefix(4).joined(separator: " ")
        return words.capitalizedFirst
    }
}
