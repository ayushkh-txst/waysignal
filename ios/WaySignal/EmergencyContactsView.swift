import SwiftUI
import CoreLocation
import UIKit

struct EmergencyContact: Identifiable {
    let id: String; let title: String; let icon: String
    let phone: String; let detail: String; let website: String
    let source: String; let sourceURL: String
}
enum ContactArea: String, CaseIterable, Identifiable {
    case nepal, unitedStates, sanMarcos, houston
    var id: String { rawValue }
    var title: String {
        switch self {
        case .nepal: return "Nepal / Kathmandu"
        case .unitedStates: return "United States"
        case .sanMarcos: return "San Marcos, Texas"
        case .houston: return "Houston, Texas"
        }
    }
    static func resolve(country: String?, state: String?, city: String?) -> ContactArea? {
        if country == "NP" { return .nepal }
        guard country == "US" else { return nil }
        if state == "TX" && city == "San Marcos" { return .sanMarcos }
        if state == "TX" && city == "Houston" { return .houston }
        return .unitedStates
    }
    var contacts: [EmergencyContact] {
        let operatorURL = "https://www.ncell.com.np/en/individual/emergency-services-information"
        let usaURL = "https://www.911.gov/calling-911/"
        if self == .nepal {
            return [
                .init(id: "police", title: "Police", icon: "shield.lefthalf.filled", phone: "100", detail: "Nepal Police emergency control.", website: "https://www.nepalpolice.gov.np/", source: "Ncell emergency directory", sourceURL: operatorURL),
                .init(id: "fire", title: "Fire & rescue", icon: "flame.fill", phone: "101", detail: "Fire support. Describe the location and type of emergency.", website: operatorURL, source: "Ncell emergency directory", sourceURL: operatorURL),
                .init(id: "ambulance", title: "Ambulance", icon: "cross.case.fill", phone: "102", detail: "Emergency medical support. Coverage varies by area.", website: "https://travel.state.gov/en/international-travel/travel-advisories/nepal.html", source: "Ncell emergency directory", sourceURL: operatorURL),
                .init(id: "air-rescue", title: "Air / helicopter rescue", icon: "airplane", phone: "1191", detail: "Nepal Army search & rescue coordination. Ask about evacuation needs; this is not a direct helicopter booking line.", website: operatorURL, source: "Ncell: Army Search & Rescue Relief", sourceURL: operatorURL),
                .init(id: "disaster", title: "Disaster helpline", icon: "water.waves", phone: "1234", detail: "Bipad disaster emergency helpline.", website: "https://ndrrma.gov.np/", source: "Ncell emergency directory", sourceURL: operatorURL),
                .init(id: "traffic", title: "Traffic support", icon: "car.fill", phone: "103", detail: "Traffic Police assistance.", website: "https://www.nepalpolice.gov.np/", source: "Ncell emergency directory", sourceURL: operatorURL)
            ]
        }
        let localURL = self == .sanMarcos ? "https://www.sanmarcostx.gov/1472/9-1-1-What-to-do" : self == .houston ? "https://www.houstontx.gov/police/contact/911.htm" : usaURL
        let rescueURL = (self == .sanMarcos || self == .houston) ? "https://www.dps.texas.gov/section/aircraft-operations-division" : usaURL
        return [
            .init(id: "police", title: "Police emergency", icon: "shield.lefthalf.filled", phone: "911", detail: "Connect to local emergency dispatch.", website: localURL, source: "National 911 Program", sourceURL: usaURL),
            .init(id: "fire", title: "Fire & rescue", icon: "flame.fill", phone: "911", detail: "Ask emergency dispatch for fire or rescue assistance.", website: localURL, source: "National 911 Program", sourceURL: usaURL),
            .init(id: "ambulance", title: "Ambulance / EMS", icon: "cross.case.fill", phone: "911", detail: "Ask emergency dispatch for medical assistance.", website: localURL, source: "National 911 Program", sourceURL: usaURL),
            .init(id: "air-rescue", title: "Air / helicopter rescue", icon: "airplane", phone: "911", detail: "Contact emergency dispatch for rescue coordination. Responders determine whether air support is appropriate and available.", website: rescueURL, source: "National 911 Program", sourceURL: usaURL),
            .init(id: "community", title: "Community support", icon: "person.2.fill", phone: "211", detail: "Find local housing, food and community resources. Non-emergency service.", website: "https://www.211.org/", source: "United Way 211", sourceURL: "https://www.211.org/")
        ]
    }
}

struct EmergencyContactsView: View {
    @EnvironmentObject private var scenario: ScenarioStore
    @EnvironmentObject private var journey: JourneyStore
    @Environment(\.openURL) private var openURL
    @StateObject private var gps = LocationProvider()
    @State private var area: ContactArea?
    @State private var areaSource = "Choose a service area"
    @State private var waiting = false; @State private var resolving = false
    @State private var error: String?; @State private var call: EmergencyContact?
    @State private var callMessage: String?
    @State private var lookupID = UUID()
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("The right help,\nclose at hand.").font(.system(size: 28, weight: .bold, design: .serif)).foregroundStyle(SignalStyle.blue)
                SignalCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("Service area", selection: Binding(get: { area }, set: { area = $0; areaSource = "Selected service area"; lookupID = UUID(); waiting = false; resolving = false; error = nil; gps.error = nil })) {
                            Text("Choose area").tag(ContactArea?.none)
                            ForEach(ContactArea.allCases) { option in Text(option.title).tag(Optional(option)) }
                        }.pickerStyle(.menu)
                        Text(areaSource).font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button { error = nil; area = nil; areaSource = "Locating device"; waiting = true; lookupID = UUID(); gps.request() } label: { Label("Use my location", systemImage: "location.fill") }.disabled(waiting || resolving)
                            Spacer()
                            Button("Use map area") { useMapArea() }.disabled(resolving || waiting || journey.origin == nil)
                        }.font(.subheadline)
                        if waiting || resolving { ProgressView("Finding service area…") }
                    }
                }
                ErrorNotice(message: error ?? gps.error)
                if let area {
                    Text("Contacts for \(area.title)").font(.headline)
                    ForEach(area.contacts) { contact in contactCard(contact) }
                    Text("Numbers checked September 15, 2026. Short numbers apply within the selected country. Websites provide information; opening a website does not request emergency help.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ContentUnavailableView("Choose your area", systemImage: "globe", description: Text("This directory currently covers Nepal and the United States. No emergency number is guessed for other countries."))
                }
            }.padding(20)
        }.background(SignalStyle.background).navigationTitle("Emergency contacts").navigationBarTitleDisplayMode(.inline)
            .onAppear { if area == nil, scenario.enabled { area = .nepal; areaSource = "Riverside map area · Kathmandu, Nepal" } }
            .onChange(of: area) { _, _ in call = nil }
            .onChange(of: gps.updatedAt) { _, _ in
                guard waiting, let point = gps.coordinate else { return }; waiting = false
                Task { await resolve(point, source: "Device location") }
            }
            .onChange(of: gps.error) { _, value in if value != nil { waiting = false } }
            .task(id: waiting) {
                guard waiting else { return }
                try? await Task.sleep(for: .seconds(20))
                guard !Task.isCancelled, waiting else { return }
                waiting = false; error = "Location is taking too long. Choose your service area above."
            }
            .confirmationDialog(call.map { "Call \($0.phone) — \(area?.title ?? "selected area")?" } ?? "Call service?", isPresented: Binding(get: { call != nil }, set: { if !$0 { call = nil } }), titleVisibility: .visible) {
                if let contact = call {
                    Button("Call " + contact.phone) { dial(contact) }
                    Button("Copy number") { UIPasteboard.general.string = contact.phone; call = nil }
                }
                Button("Cancel", role: .cancel) { call = nil }
            }
            .alert("Phone call", isPresented: Binding(get: { callMessage != nil }, set: { if !$0 { callMessage = nil } })) { Button("OK") { callMessage = nil } } message: { Text(callMessage ?? "") }
    }
    private func contactCard(_ contact: EmergencyContact) -> some View {
        SignalCard {
            VStack(alignment: .leading, spacing: 12) {
                Label(contact.title, systemImage: contact.icon).font(.headline).foregroundStyle(SignalStyle.blue)
                Text(contact.phone).font(.system(size: 30, weight: .bold, design: .rounded)).textSelection(.enabled)
                Text(contact.detail).font(.subheadline).foregroundStyle(.secondary)
                HStack {
                    Button { call = contact } label: { Label("Call " + contact.phone, systemImage: "phone.fill") }.buttonStyle(.borderedProminent)
                    Spacer()
                    if let url = URL(string: contact.website) { Link(destination: url) { Label("Website", systemImage: "arrow.up.right.square") } }
                }
                if let sourceURL = URL(string: contact.sourceURL) { Link("Source: " + contact.source, destination: sourceURL).font(.caption) }
            }
        }
    }
    private func useMapArea() {
        lookupID = UUID(); gps.error = nil; error = nil
        if scenario.enabled { area = .nepal; areaSource = "Riverside map area · Kathmandu, Nepal" }
        else if let point = journey.origin { Task { await resolve(point, source: "Map starting point") } }
    }
    private func resolve(_ point: Coordinate, source: String) async {
        let id = UUID(); lookupID = id; resolving = true; error = nil; area = nil
        defer { if lookupID == id { resolving = false } }
        do {
            let place = try await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: point.latitude, longitude: point.longitude)).first
            guard lookupID == id else { return }
            area = ContactArea.resolve(country: place?.isoCountryCode, state: place?.administrativeArea, city: place?.locality)
            areaSource = source + " · " + ([place?.locality, place?.country].compactMap { $0 }).joined(separator: ", ")
            if area == nil { error = "No verified directory is available for this country. Choose a supported area only if it matches where help is needed." }
        } catch { if lookupID == id { self.error = "Could not determine the service area. Choose it above." } }
    }
    private func dial(_ contact: EmergencyContact) {
        call = nil
        #if targetEnvironment(simulator)
        callMessage = "The simulator cannot place phone calls. On an iPhone, this button opens the phone call confirmation for " + contact.phone + "."
        #else
        guard let url = URL(string: "tel:" + contact.phone) else { return }
        openURL(url) { accepted in if !accepted { callMessage = "Calling is unavailable on this device. Dial " + contact.phone + " from a phone." } }
        #endif
    }
}
