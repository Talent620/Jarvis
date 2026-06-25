import SwiftUI

/// Central HUD design system for JARVIS — dark, futuristic, cyan-on-deep-navy.
enum Theme {
    // MARK: Palette
    static let background = Color(red: 0.016, green: 0.027, blue: 0.059)   // #04070f
    static let surface    = Color(red: 0.043, green: 0.071, blue: 0.122)   // panel fill
    static let surfaceHi  = Color(red: 0.071, green: 0.118, blue: 0.196)
    static let cyan       = Color(red: 0.290, green: 0.886, blue: 0.953)   // #4ae2f3
    static let cyanDim    = Color(red: 0.290, green: 0.886, blue: 0.953).opacity(0.55)
    static let amber      = Color(red: 1.0,   green: 0.722, blue: 0.290)
    static let magenta    = Color(red: 0.949, green: 0.388, blue: 0.682)
    static let green      = Color(red: 0.376, green: 0.949, blue: 0.620)
    static let textPrimary   = Color(red: 0.886, green: 0.945, blue: 1.0)
    static let textSecondary = Color(red: 0.553, green: 0.651, blue: 0.741)

    // MARK: Type — Orbitron/Rajdhani feel mapped to system monospaced + rounded
    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
    static func ui(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static let corner: CGFloat = 18
}

// MARK: - Reusable HUD surfaces

/// A glassy bordered panel used throughout the HUD.
struct HUDPanel<Content: View>: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .fill(Theme.surface.opacity(0.65))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .stroke(Theme.cyan.opacity(0.22), lineWidth: 1)
            )
    }
}

extension View {
    func hudPanel() -> some View { modifier(HUDPanel()) }

    /// Full-screen HUD backdrop with a faint grid + radial glow.
    func hudBackground() -> some View {
        background(
            ZStack {
                Theme.background.ignoresSafeArea()
                RadialGradient(
                    colors: [Theme.cyan.opacity(0.12), .clear],
                    center: .top, startRadius: 10, endRadius: 520
                )
                .ignoresSafeArea()
                GridOverlay().opacity(0.06).ignoresSafeArea()
            }
        )
    }
}

/// Subtle technical grid drawn behind content.
struct GridOverlay: View {
    var spacing: CGFloat = 32
    var body: some View {
        Canvas { ctx, size in
            var path = Path()
            var x: CGFloat = 0
            while x <= size.width { path.move(to: .init(x: x, y: 0)); path.addLine(to: .init(x: x, y: size.height)); x += spacing }
            var y: CGFloat = 0
            while y <= size.height { path.move(to: .init(x: 0, y: y)); path.addLine(to: .init(x: size.width, y: y)); y += spacing }
            ctx.stroke(path, with: .color(Theme.cyan), lineWidth: 0.5)
        }
    }
}
