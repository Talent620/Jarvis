import UIKit

/// Tiny wrapper around UIKit haptics so the HUD feels physical.
enum Haptics {
    static func tap() {
        let g = UIImpactFeedbackGenerator(style: .light)
        g.impactOccurred()
    }
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
    static func select() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
