import SwiftUI

/// Section header with a HUD tick decoration.
struct SectionHeader: View {
    var title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Rectangle().fill(Theme.cyan).frame(width: 14, height: 2)
                Text(title.uppercased())
                    .font(Theme.display(13, weight: .heavy))
                    .tracking(2)
                    .foregroundStyle(Theme.cyan)
            }
            if let subtitle {
                Text(subtitle)
                    .font(Theme.ui(12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// Empty-state placeholder used by module lists.
struct EmptyHint: View {
    var icon: String
    var text: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.cyanDim)
            Text(text)
                .font(Theme.ui(14))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

/// Primary HUD button.
struct HUDButton: View {
    var title: String
    var icon: String? = nil
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon) }
                Text(title).font(Theme.ui(15, weight: .semibold))
            }
            .foregroundStyle(Theme.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Theme.cyan)
            )
        }
        .buttonStyle(.plain)
    }
}

/// Bordered text field matching the HUD style.
struct HUDField: View {
    var placeholder: String
    @Binding var text: String
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 10) {
            if let icon { Image(systemName: icon).foregroundStyle(Theme.cyanDim) }
            TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.textSecondary))
                .foregroundStyle(Theme.textPrimary)
                .font(Theme.ui(15))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.background.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.cyan.opacity(0.25), lineWidth: 1)
        )
    }
}

/// A tappable card row used by list modules.
struct CheckRow: View {
    var text: String
    var done: Bool
    var detail: String? = nil
    var onToggle: () -> Void
    var onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(done ? Theme.green : Theme.cyanDim)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(text)
                    .font(Theme.ui(15))
                    .foregroundStyle(done ? Theme.textSecondary : Theme.textPrimary)
                    .strikethrough(done, color: Theme.textSecondary)
                if let detail {
                    Text(detail).font(Theme.ui(12)).foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer()
            Button(action: onDelete) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .hudPanel()
    }
}
