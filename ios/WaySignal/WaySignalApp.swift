import SwiftUI

@main struct WaySignalApp: App {
    @StateObject private var session = SessionStore()
    var body: some Scene {
        WindowGroup {
            Group {
                if let client = session.client, let account = session.account?.user {
                    Workspace(client: client, account: account).id(session.account?.accessToken)
                } else { SignInView() }
            }.environmentObject(session).tint(SignalStyle.blue)
        }
    }
}
struct SignInView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var email = ""; @State private var password = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                        .font(.system(size: 42, weight: .semibold)).foregroundStyle(SignalStyle.blue).padding(.top, 32)
                    Text("Better signals.\nBetter next steps.").font(.largeTitle.bold())
                    Text("WaySignal connects community observations, route decisions, and the people responding.")
                        .foregroundStyle(.secondary)
                    SignalCard {
                        VStack(spacing: 16) {
                            TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress)
                            SecureField("Password", text: $password).textContentType(.password)
                            DisclosureGroup("Server connection") {
                                TextField("Server origin", text: $session.server).keyboardType(.URL)
                                Text("Simulator: http://localhost:8000. On iPhone, enter your server address.").font(.caption).foregroundStyle(.secondary)
                            }
                        }.textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                    }
                    ErrorNotice(message: session.error)
                    PrimaryButton(title: "Sign in", icon: "arrow.right", busy: session.busy, disabled: email.isEmpty || password.isEmpty) {
                        Task { await session.signIn(email: email, password: password) }
                    }
                    Notice(text: "Hackathon prototype. Requests go to this project's responder dashboard; this is not an emergency service.")
                }.padding(24)
            }.background(SignalStyle.background).navigationTitle("WaySignal").navigationBarTitleDisplayMode(.inline)
        }
    }
}
struct Workspace: View {
    let client: APIClient; let account: Account
    @StateObject private var journey: JourneyStore
    @StateObject private var community: CommunityStore
    @StateObject private var assistance: AssistanceStore
    @StateObject private var guide: GuideStore
    @StateObject private var location = LocationProvider()
    init(client: APIClient, account: Account) {
        self.client = client; self.account = account
        _journey = StateObject(wrappedValue: JourneyStore(service: RouteService(client: client)))
        _community = StateObject(wrappedValue: CommunityStore(service: CommunityService(client: client)))
        _assistance = StateObject(wrappedValue: AssistanceStore(service: AssistanceService(client: client)))
        _guide = StateObject(wrappedValue: GuideStore(service: GuideService(client: client)))
    }
    var body: some View {
        TabView {
            NavigationStack { JourneyView() }.tabItem { Label("Map", systemImage: "map") }
            NavigationStack { CommunityView() }.tabItem { Label("Community", systemImage: "person.2") }
            NavigationStack { AssistanceView(account: account) }.tabItem { Label("Help", systemImage: "hand.raised") }
            NavigationStack { GuideView() }.tabItem { Label("Guide", systemImage: "sparkle.magnifyingglass") }
        }.environmentObject(journey).environmentObject(community).environmentObject(assistance)
            .environmentObject(guide).environmentObject(location)
            .onChange(of: location.coordinate) { _, value in if let value { journey.origin = value } }
    }
}
struct AccountView: View {
    @EnvironmentObject private var session: SessionStore
    var body: some View {
        List {
            Section("Account") {
                Text(session.account?.user.name ?? "")
                Text(session.account?.user.email ?? "").foregroundStyle(.secondary)
            }
            Section("G-one workspace") {
                if let url = URL(string: session.server) {
                    Link("Open full web application", destination: url)
                }
                Text("All inherited G-one modules remain in the web application: forecasts, facilities, voice and AI tools, route analysis, responder dispatch and operational reports. Sign in separately in the browser.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("About this build") {
                Text("Navigation × Social Media × Productivity")
                Text("Community review is project review, not official road certification. The Guide summarizes records through MCP.").font(.footnote)
            }
            Button("Sign out", role: .destructive) { session.signOut() }
        }.navigationTitle("Your workspace")
    }
}
