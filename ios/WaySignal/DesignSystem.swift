import SwiftUI

enum SignalStyle {
    static let blue = Color(red: 0.04, green: 0.14, blue: 0.25)
    static let gold = Color(red: 0.48, green: 0.36, blue: 0.10)
    static let ink = Color.primary
    static let background = Color(red: 0.98, green: 0.97, blue: 0.95)
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
        }.buttonStyle(SignalPressStyle())
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

struct SignalPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(.white).padding(10)
            .background(SignalStyle.blue, in: RoundedRectangle(cornerRadius: 16))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: configuration.isPressed)
    }
}
struct BrandHeading: View {
    var compact = false
    var body: some View {
        HStack(spacing: 10) {
            Image("BrandMark").resizable().scaledToFit().frame(width: compact ? 40 : 60, height: compact ? 40 : 60)
                .clipShape(RoundedRectangle(cornerRadius: 12)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("WaySignal").font(compact ? .headline : .title2.bold()).foregroundStyle(SignalStyle.blue)
                if !compact { Text("COMMUNITY IN MOTION").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.5).foregroundStyle(SignalStyle.gold) }
            }
        }
    }
}
struct LandscapeBanner: View {
    var height: CGFloat = 140
    var body: some View {
        // The image is decoration: its aspect ratio must never set the page width.
        Color(red: 0.97, green: 0.93, blue: 0.85)
            .frame(height: height)
            .overlay {
                GeometryReader { geometry in
                    Image("Landscape").resizable().scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                }
            }.clipped().accessibilityHidden(true)
    }
}
struct ViewportScrollView<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                content.frame(width: max(0, geometry.size.width), alignment: .leading)
            }
        }
    }
}
struct DemoDataIndicator: ViewModifier {
    @EnvironmentObject private var scenario: ScenarioStore
    func body(content: Content) -> some View {
        content.toolbar {
            if scenario.enabled {
                ToolbarItem(placement: .topBarTrailing) {
                    Text("Demo data").font(.caption2.weight(.medium))
                        .foregroundStyle(SignalStyle.gold)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(SignalStyle.gold.opacity(0.08), in: Capsule())
                        .accessibilityLabel("Demo mode. Simulated data.")
                }
            }
        }
    }
}
struct MetricTile: View {
    let title: String; let value: String; let icon: String
    var color: Color = SignalStyle.blue
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).foregroundStyle(color)
            Text(value).font(.title2.bold()).contentTransition(.numericText())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
    }
}
