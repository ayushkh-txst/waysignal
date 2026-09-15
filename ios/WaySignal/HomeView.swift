import SwiftUI

struct HomeView: View {
    let account: Account
    @EnvironmentObject private var context: ContextStore
    @EnvironmentObject private var journey: JourneyStore
    @EnvironmentObject private var community: CommunityStore
    @EnvironmentObject private var assistance: AssistanceStore
    @EnvironmentObject private var navigation: AppNavigation
    @EnvironmentObject private var location: LocationProvider
    @EnvironmentObject private var scenario: ScenarioStore
    var body: some View {
        ViewportScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your community.\nYour next step.").font(.system(size: 32, weight: .bold, design: .serif)).foregroundStyle(SignalStyle.blue)
                    Text(context.places?.location.primary ?? "Welcome, \(account.name)").font(.subheadline).foregroundStyle(.secondary)
                }
                LandscapeBanner(height: 110).clipShape(RoundedRectangle(cornerRadius: 20))
                PrimaryButton(title: "Explore the map", icon: "map.fill") { navigation.tab = "map" }
                HStack {
                    MetricTile(title: "Active observations", value: "\(community.reports.filter { $0.status == "active" }.count)", icon: "bubble.left.and.exclamationmark.bubble.right")
                    MetricTile(title: "Your open requests", value: "\(assistance.requests.filter { !["resolved", "cancelled"].contains($0.status) }.count)", icon: "hand.raised.fill")
                }
                HStack {
                    Button { navigation.tab = "community" } label: { Label("Share a signal", systemImage: "plus.bubble") }
                    Spacer()
                    Button { navigation.tab = "help" } label: { Label("Request help", systemImage: "hand.raised") }
                }.font(.subheadline.bold()).padding(.vertical, 4)
                HStack { Text("Local conditions").font(.title3.bold()); Spacer(); if context.busy { ProgressView() } }
                if let conditions = context.conditions {
                    ConditionsCard(conditions: conditions)
                } else if !context.busy {
                    Button("Use my location to load conditions") { if scenario.enabled { scenario.useStart(journey) } else { location.request() } }.buttonStyle(.bordered)
                }
                ErrorNotice(message: context.weatherError)
                Button { navigation.ask("What do the rain and river forecasts mean for my route?") } label: {
                    SignalCard {
                        HStack(spacing: 14) {
                            Image(systemName: "sparkles").font(.title2).foregroundStyle(SignalStyle.gold)
                            VStack(alignment: .leading, spacing: 4) { Text("Ask Nav AI").font(.headline); Text("Weather, routes, reports and request updates.").font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Image(systemName: "arrow.up.right")
                        }
                    }
                }.buttonStyle(.plain)
                Text("Places nearby").font(.title3.bold())
                if let places = context.places {
                    ForEach(places.facilities.prefix(4)) { place in
                        Button {
                            journey.destination = place.coordinate; journey.destinationName = place.name; navigation.tab = "map"
                        } label: {
                            SignalCard { HStack { Image(systemName: place.icon).foregroundStyle(SignalStyle.gold); VStack(alignment: .leading) { Text(place.name).font(.subheadline.bold()); Text("\(place.kind.capitalized) · availability unverified").font(.caption).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "arrow.up.right") } }
                        }.buttonStyle(.plain)
                    }

                }
                ErrorNotice(message: context.placesError)
            }.padding(20)
        }.background(SignalStyle.background).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { BrandHeading(compact: true) }
                ToolbarItem(placement: .topBarTrailing) { NavigationLink { AccountView() } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("Account") }
            }
            .refreshable { await community.load(); await assistance.load(); if let origin = journey.origin { await context.load(origin) } }
    }
}
struct ConditionsCard: View {
    let conditions: LocalConditions
    var body: some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label(conditions.temperatureC.map { String(format: "%.1f°C", $0) } ?? "Forecast", systemImage: "cloud.rain.fill").font(.title2.bold())
                    Spacer(); Text("NEXT 6 HOURS").font(.caption2.bold()).foregroundStyle(SignalStyle.gold)
                }
                HStack(alignment: .top, spacing: 20) {
                    VStack(alignment: .leading) { Text(String(format: "%.1f mm", conditions.precipitationNext6hMm)).font(.headline); Text("Rain forecast").font(.caption).foregroundStyle(.secondary) }
                    if let river = conditions.riverDischargeM3s { VStack(alignment: .leading) { Text(String(format: "%.1f m³/s", river)).font(.headline); Text("River forecast").font(.caption).foregroundStyle(.secondary) } }
                }
                if let trend = conditions.riverTrendPercent { Text("River forecast change: \(trend.formatted(.number.precision(.fractionLength(1))))%").font(.footnote) }
                Text("\(conditions.source) · \(Wire.date(conditions.observedAt))").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
