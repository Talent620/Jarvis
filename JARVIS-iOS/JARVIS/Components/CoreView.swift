import SwiftUI

/// The animated central "Rdzeń" — pulsing reactor that changes colour with mood
/// and reacts when JARVIS is listening or speaking.
struct CoreView: View {
    var mood: Mood
    var active: Bool          // listening or speaking
    var size: CGFloat = 220

    @State private var phase: CGFloat = 0
    @State private var rotation: Double = 0

    var body: some View {
        let color = mood.color
        ZStack {
            // Outer rotating ticks
            TickRing(count: 60)
                .stroke(color.opacity(0.5), lineWidth: 1.4)
                .frame(width: size, height: size)
                .rotationEffect(.degrees(rotation))

            // Concentric rings
            ForEach(0..<3) { i in
                Circle()
                    .stroke(color.opacity(0.35 - Double(i) * 0.08), lineWidth: 1.5)
                    .frame(width: size - CGFloat(i) * 34, height: size - CGFloat(i) * 34)
            }

            // Reactive pulse halo
            Circle()
                .fill(
                    RadialGradient(colors: [color.opacity(active ? 0.55 : 0.30), .clear],
                                   center: .center, startRadius: 4, endRadius: size * 0.5)
                )
                .frame(width: size * 0.75, height: size * 0.75)
                .scaleEffect(1 + 0.06 * sin(phase) * CGFloat(active ? 2 : 1))

            // Core orb
            Circle()
                .fill(
                    RadialGradient(colors: [.white.opacity(0.9), color, color.opacity(0.2)],
                                   center: .init(x: 0.4, y: 0.35), startRadius: 2, endRadius: size * 0.3)
                )
                .frame(width: size * 0.42, height: size * 0.42)
                .shadow(color: color.opacity(0.8), radius: active ? 30 : 16)
                .scaleEffect(1 + 0.04 * sin(phase * 1.6))

            // Audio bars when active
            if active {
                AudioBars(color: color)
                    .frame(width: size * 0.5, height: size * 0.28)
            }
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.linear(duration: 0.04).repeatForever(autoreverses: false)) { phase = .pi * 2 }
            withAnimation(.linear(duration: 24).repeatForever(autoreverses: false)) { rotation = 360 }
        }
        .animation(.easeInOut(duration: 0.6), value: mood)
    }
}

/// Tick marks arranged in a ring.
private struct TickRing: Shape {
    var count: Int
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = rect.width / 2
        for i in 0..<count {
            let a = CGFloat(i) / CGFloat(count) * .pi * 2
            let long = i % 5 == 0
            let r2 = r - (long ? 12 : 6)
            p.move(to: CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a)))
            p.addLine(to: CGPoint(x: c.x + r2 * cos(a), y: c.y + r2 * sin(a)))
        }
        return p
    }
}

/// Simple animated equalizer bars shown while active.
private struct AudioBars: View {
    var color: Color
    @State private var t: CGFloat = 0
    var body: some View {
        GeometryReader { geo in
            let n = 9
            HStack(alignment: .center, spacing: geo.size.width / CGFloat(n) * 0.4) {
                ForEach(0..<n, id: \.self) { i in
                    Capsule()
                        .fill(color)
                        .frame(height: barHeight(i, geo.size.height))
                }
            }
            .frame(maxHeight: .infinity, alignment: .center)
        }
        .onAppear {
            withAnimation(.linear(duration: 0.08).repeatForever(autoreverses: false)) { t = 100 }
        }
    }
    private func barHeight(_ i: Int, _ h: CGFloat) -> CGFloat {
        let v = abs(sin((t + CGFloat(i) * 7) * 0.3))
        return max(4, h * (0.25 + 0.75 * v))
    }
}
