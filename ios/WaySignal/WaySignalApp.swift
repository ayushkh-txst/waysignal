import SwiftUI

@main struct WaySignalApp: App {
    @StateObject private var session = SessionStore()
    var body: some Scene {
        WindowGroup {
            Group {
                if let client = session.client, let account = session.account?.user {
                    Workspace(client: client, account: account).id(session.account?.accessToken)
                } else { SignInView() }
            }.environmentObject(session).tint(SignalStyle.blue).preferredColorScheme(.light)
        }
    }
}
struct SignInView: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var email = ""; @State private var password = ""
    @State private var workspace = "citizen"; @State private var appeared = false
    var body: some View {
        NavigationStack {
            ViewportScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    BrandHeading().padding(.horizontal, 24).padding(.top, 20)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Better signals.\nBetter next steps.").font(.system(size: 36, weight: .bold, design: .serif)).foregroundStyle(SignalStyle.blue)
                        Text("Know what is ahead. Share what you see. Help your community move with confidence.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }.padding(24)
                    LandscapeBanner()
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Welcome back").font(.title2.bold())
                        Picker("Workspace", selection: $workspace) {
                            Text("Citizen").tag("citizen"); Text("Admin").tag("worker")
                        }.pickerStyle(.segmented)
                        Text(workspace == "citizen" ? "Explore routes, share observations, and request help." : "Review reports, coordinate incidents, and track response.").font(.subheadline).foregroundStyle(.secondary)
                        SignalCard {
                            VStack(spacing: 18) {
                                TextField("Email address", text: $email).textContentType(.username).keyboardType(.emailAddress)
                                Divider()
                                SecureField("Password", text: $password).textContentType(.password)
                            }.textInputAutocapitalization(.never).autocorrectionDisabled()
                        }
                        Toggle("Keep me signed in", isOn: $session.rememberSignIn).font(.subheadline)
                        ErrorNotice(message: session.error)
                        PrimaryButton(title: "Sign in", icon: "arrow.right", busy: session.busy, disabled: email.isEmpty || password.isEmpty,
                                      fill: SignalStyle.signInButton, trailingIcon: true) {
                            Task { await session.signIn(email: email, password: password) }
                        }
                    }.padding(24)
                }.opacity(appeared ? 1 : 0).offset(y: appeared || reduceMotion ? 0 : 10)
            }.background(SignalStyle.background).toolbar(.hidden, for: .navigationBar)
                .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) { appeared = true } }
        }
    }
}
struct Workspace: View {
    let client: APIClient; let account: Account
    @StateObject private var scenario: ScenarioStore
    @StateObject private var journey: JourneyStore
    @StateObject private var community: CommunityStore
    @StateObject private var assistance: AssistanceStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var guide: GuideStore
    @StateObject private var location = LocationProvider()
    @StateObject private var navigation = AppNavigation()
    @StateObject private var context: ContextStore
    @StateObject private var operations: OperationsStore
    init(client: APIClient, account: Account) {
        self.client = client; self.account = account
        _context = StateObject(wrappedValue: ContextStore(service: ContextService(client: client)))
        _operations = StateObject(wrappedValue: OperationsStore(service: ResponderService(client: client)))
        _scenario = StateObject(wrappedValue: ScenarioStore(client: client))
        _journey = StateObject(wrappedValue: JourneyStore(service: RouteService(client: client)))
        _community = StateObject(wrappedValue: CommunityStore(service: CommunityService(client: client)))
        _assistance = StateObject(wrappedValue: AssistanceStore(service: AssistanceService(client: client)))
        _guide = StateObject(wrappedValue: GuideStore(service: GuideService(client: client)))
    }
    var body: some View {
        Group {
          if scenario.info == nil {
            VStack(spacing: 16) {
                Text("Checking server connection…")
                ErrorNotice(message: scenario.error)
                if scenario.error != nil { Button("Retry") { Task { await scenario.load() } } }
            }.padding()
          } else {
            if account.role == "worker" {
                ResponderWorkspace(account: account)
            } else {
                TabView(selection: $navigation.tab) {
                    NavigationStack { HomeView(account: account) }.tabItem { Label("Home", systemImage: "house") }.tag("home")
                    NavigationStack { JourneyView() }.tabItem { Label("Map", systemImage: "map") }.tag("map")
                    NavigationStack { CommunityView() }.tabItem { Label("Community", systemImage: "person.2") }.tag("community")
                    NavigationStack { AssistanceView(account: account) }.tabItem { Label("Help", systemImage: "hand.raised") }.tag("help")
                    NavigationStack { GuideView() }.tabItem { Label("Nav AI", systemImage: "sparkles") }.tag("guide")
                }
            }
          }
        }.environmentObject(journey).environmentObject(community).environmentObject(assistance)
            .environmentObject(guide).environmentObject(location).environmentObject(scenario)
            .environmentObject(context).environmentObject(operations).environmentObject(navigation)
            .task {
                await scenario.load()
                if scenario.enabled { scenario.useStart(journey) }
                await community.load()
                if account.role == "worker" { await operations.load() } else { await assistance.load() }
                if let origin = journey.origin { await context.load(origin, includePlaces: account.role == "citizen") }
                if scenario.enabled { await journey.assess() }
            }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(8)) } catch { return }
                    await community.load()
                }
            }
            .onChange(of: community.mapState?.revision) { previous, current in
                if previous != nil, previous != current { Task { await journey.refreshRoute() } }
            }
            .onChange(of: location.coordinate) { _, value in if !scenario.enabled, let value { journey.origin = value; Task { await context.load(value, includePlaces: account.role == "citizen") } } }
    }
}
struct AccountView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var scenario: ScenarioStore
    var body: some View {
        List {
            Section("Account") {
                Text(session.account?.user.name ?? "")
                Text(session.account?.user.email ?? "").foregroundStyle(.secondary)
            }
            if scenario.enabled {
                Section("Demo data") {
                    Text("This exercise uses simulated conditions, routes, observations and people. It is not a live emergency.").font(.footnote)
                }
            }
            Section("G-one workspace") {
                if let url = URL(string: session.server) {
                    Link("Open full web application", destination: url)
                }
                Text("The original G-one web workspace remains available for additional dispatch and administrative tools. Sign in separately in the browser.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("About this build") {
                Text("Navigation × Social Media × Productivity")
                Text("Community review is project review, not official road certification. Nav AI summarizes records through MCP.").font(.footnote)
            }
            Button("Sign out", role: .destructive) { session.signOut() }
        }.navigationTitle("Your workspace")
    }
}
