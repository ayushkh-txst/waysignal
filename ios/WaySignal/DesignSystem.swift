import SwiftUI

enum SignalStyle {
    static let blue = Color(red: 0.082, green: 0.369, blue: 0.937)
    static let ink = Color.primary
    static let background = Color(uiColor: .systemGroupedBackground)
    static func stateColor(_ state: String) -> Color {
        switch state {
        case "reviewed_active": return Color(red: 0.706, green: 0.137, blue: 0.094)
        case "unreviewed", "submitted", "expired": return Color(red: 0.604, green: 0.341, blue: 0)
        case "resolved": return Color(red: 0.059, green: 0.463, blue: 0.431)
        case "assigned", "en_route": return blue
        default: return .secondary
        }
    }
    static func label(_ state: String) -> String {
        switch state {
        case "reviewed_active": return "Reviewed · active"
        case "unreviewed": return "Needs review"
        case "expired": return "Stale · needs review"
        case "en_route": return "En route"
        default: return state.capitalized
        }
    }
}
struct StatusPill: View {
    let state: String
    var body: some View {
        Label(SignalStyle.label(state), systemImage: state == "reviewed_active" ? "exclamationmark.triangle.fill" : state == "resolved" ? "checkmark.circle.fill" : "clock")
            .font(.caption.weight(.semibold)).foregroundStyle(SignalStyle.stateColor(state))
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(SignalStyle.stateColor(state).opacity(0.1), in: Capsule())
    }
}
struct Notice: View {
    let text: String
    var warning = false
    var body: some View {
        Label(text, systemImage: warning ? "exclamationmark.triangle" : "info.circle")
            .font(.footnote).foregroundStyle(warning ? Color.orange : .secondary)
            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }
}
struct ErrorNotice: View {
    let message: String?
    var body: some View { if let message { Notice(text: message, warning: true) } }
}
struct SignalCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        content.frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}
struct PrimaryButton: View {
    let title: String; let icon: String
    var busy = false; var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack { if busy { ProgressView().tint(.white) }; Label(title, systemImage: icon) }
                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 8)
        }.buttonStyle(.borderedProminent).buttonBorderShape(.roundedRectangle(radius: 14))
            .disabled(disabled || busy)
    }
}
struct CoordinateFields: View {
    let title: String
    @Binding var latitude: String; @Binding var longitude: String
    var body: some View {
        Section(title) {
            TextField("Latitude (−90 to 90)", text: $latitude)
            TextField("Longitude (−180 to 180)", text: $longitude)
        }.keyboardType(.numbersAndPunctuation).textInputAutocapitalization(.never).autocorrectionDisabled()
    }
}
