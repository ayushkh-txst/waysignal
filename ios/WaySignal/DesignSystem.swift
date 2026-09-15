import SwiftUI
import MapKit

enum SignalStyle {
    static let blue = Color(red: 0.04, green: 0.14, blue: 0.25)
    static let gold = Color(red: 0.48, green: 0.36, blue: 0.10)
    static let signInButton = Color(red: 105.0 / 255, green: 94.0 / 255, blue: 66.0 / 255)
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
    var fill: Color = SignalStyle.blue
    var trailingIcon = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(.white) }
                if trailingIcon {
                    Text(title)
                    Image(systemName: icon).accessibilityHidden(true)
                } else { Label(title, systemImage: icon) }
            }
                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 8)
        }.buttonStyle(SignalPressStyle(fill: fill))
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
    var fill: Color = SignalStyle.blue
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(.white).padding(10)
            .background(fill, in: RoundedRectangle(cornerRadius: 16))
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

// One map layer and legend shared by both workspaces.
struct MapRiskLayer: MapContent {
    let snapshot: MapSnapshot?
    var body: some MapContent {
        ForEach(snapshot?.zones ?? []) { zone in
            MapCircle(center: zone.coordinate, radius: zone.radiusM)
                .foregroundStyle((zone.level == "critical" ? Color.red : .orange).opacity(0.22))
                .stroke(zone.level == "critical" ? Color.red : .orange, lineWidth: 2)
        }
        ForEach((snapshot?.shelters ?? []).filter { $0.available }) { site in
            MapCircle(center: site.coordinate.location, radius: site.radiusM)
                .foregroundStyle(Color.green.opacity(0.25)).stroke(.green, lineWidth: 2)
        }
    }
}
struct MapRiskLegend: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("Critical · reviewed hazard", systemImage: "circle.fill").foregroundStyle(.red)
            Label("Danger · awaiting review", systemImage: "circle.fill").foregroundStyle(.orange)
            Label("Safe point · open shelter", systemImage: "circle.fill").foregroundStyle(.green)
        }.font(.caption2.bold()).padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

// Display labels never replace stable identifiers used by API requests.
enum SignalCopy {
    static func recordID(_ id: String) -> String {
        id.hasPrefix("WS-DEMO-") ? id.replacingOccurrences(of: "WS-DEMO-", with: "WS-") : id
    }
    static func review(_ text: String, id: String) -> String {
        guard id.hasPrefix("WS-DEMO-") else { return text }
        return text.replacingOccurrences(of: "Demo responder review: ", with: "")
            .replacingOccurrences(of: "Demo responder update: ", with: "")
            .replacingOccurrences(of: " in this exercise", with: "")
    }
}
