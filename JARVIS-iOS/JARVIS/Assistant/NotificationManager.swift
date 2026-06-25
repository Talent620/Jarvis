import Foundation
import UserNotifications

/// Schedules local notifications so reminders fire even when the app is closed.
@MainActor
final class NotificationManager {
    static let shared = NotificationManager()
    private init() {}

    /// Ask for permission (called lazily when the first reminder is scheduled).
    func requestAuthorization() async -> Bool {
        let center = UNUserNotificationCenter.current()
        do {
            return try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    /// Schedule (or reschedule) a notification for a reminder.
    func schedule(_ reminder: Reminder) {
        guard reminder.date > Date(), !reminder.done else {
            cancel(reminder.id)
            return
        }
        Task {
            let granted = await requestAuthorization()
            guard granted else { return }

            let content = UNMutableNotificationContent()
            content.title = "JARVIS — przypomnienie"
            content.body = reminder.text
            content.sound = .default

            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: reminder.date)
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
            let request = UNNotificationRequest(identifier: reminder.id.uuidString, content: content, trigger: trigger)
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    func cancel(_ id: UUID) {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: [id.uuidString])
    }

    /// Keep system notifications in sync with the current reminder list.
    func sync(_ reminders: [Reminder]) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let pendingIDs = Set(pending.map(\.identifier))
            let activeIDs = Set(reminders.filter { !$0.done && $0.date > Date() }.map { $0.id.uuidString })
            // Cancel notifications for reminders that no longer exist / are done.
            let stale = pendingIDs.subtracting(activeIDs)
            if !stale.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: Array(stale))
            }
        }
        // (Re)schedule active reminders.
        for r in reminders where !r.done && r.date > Date() { schedule(r) }
    }
}
