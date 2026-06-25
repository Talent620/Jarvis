import SwiftUI

// MARK: - Domain models (all Codable for local persistence)

struct TaskItem: Identifiable, Codable, Hashable {
    var id = UUID()
    var title: String
    var done: Bool = false
    var createdAt: Date = Date()
}

struct Note: Identifiable, Codable, Hashable {
    var id = UUID()
    var title: String
    var body: String
    var createdAt: Date = Date()
}

struct Reminder: Identifiable, Codable, Hashable {
    var id = UUID()
    var text: String
    var date: Date
    var done: Bool = false
}

struct ShoppingItem: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String
    var bought: Bool = false
}

struct CalendarEvent: Identifiable, Codable, Hashable {
    var id = UUID()
    var title: String
    var date: Date
}

struct ChatMessage: Identifiable, Codable, Hashable {
    var id = UUID()
    var role: Role
    var text: String
    var date: Date = Date()
    enum Role: String, Codable { case user, jarvis }
}

// MARK: - Mood — drives the colour of the central core ("Rdzeń zmienia barwę wraz z nastrojem")

enum Mood: String, Codable, CaseIterable {
    case calm, happy, focused, tired, tense, angry, dreamy

    var label: String {
        switch self {
        case .calm:    return "spokojny"
        case .happy:   return "szczęśliwy"
        case .focused: return "skupiony"
        case .tired:   return "zmęczony"
        case .tense:   return "spięty"
        case .angry:   return "zły"
        case .dreamy:  return "rozmarzony"
        }
    }

    var color: Color {
        switch self {
        case .calm:    return Theme.cyan
        case .happy:   return Theme.green
        case .focused: return Color(red: 0.45, green: 0.7, blue: 1.0)
        case .tired:   return Color(red: 0.6, green: 0.6, blue: 0.75)
        case .tense:   return Theme.amber
        case .angry:   return Color(red: 1.0, green: 0.42, blue: 0.42)
        case .dreamy:  return Theme.magenta
        }
    }
}

// MARK: - Modules (the HUD navigation, mirroring the original app)

enum Module: String, CaseIterable, Identifiable {
    case mind      // Umysł
    case tasks     // Zadania
    case notes     // Notatki
    case reminders // Przypomnienia
    case calendar  // Kalendarz
    case shopping  // Zakupy
    case settings  // Ustawienia

    var id: String { rawValue }

    var title: String {
        switch self {
        case .mind:      return "Umysł"
        case .tasks:     return "Zadania"
        case .notes:     return "Notatki"
        case .reminders: return "Przypomnienia"
        case .calendar:  return "Kalendarz"
        case .shopping:  return "Zakupy"
        case .settings:  return "Ustawienia"
        }
    }

    var icon: String {
        switch self {
        case .mind:      return "brain"
        case .tasks:     return "checklist"
        case .notes:     return "note.text"
        case .reminders: return "bell.fill"
        case .calendar:  return "calendar"
        case .shopping:  return "cart.fill"
        case .settings:  return "gearshape.fill"
        }
    }
}
