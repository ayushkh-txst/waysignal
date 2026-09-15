# WaySignal

<img src="ios/WaySignal/Assets.xcassets/BrandMark.imageset/WaySignal.png" width="120" alt="WaySignal walking W logo">

**Know the route. Share the signal.**

WaySignal is an iPhone prototype connecting community observations, route decisions and responder coordination. A reviewed road hazard changes a route assessment; an assistance request becomes a task with visible progress.

Built for TXST Shipaton using **SwiftUI, MapKit, FastAPI and authenticated MCP**, with the existing G-one web workspace available for responders.

## The category fusion

**Navigation × Social Media**, supported by **Productivity**.

Community posts are location-based observations with evidence and a review history. Navigation uses these observations to assess route candidates; the journey also determines which observations are relevant. Responder reviews change the next assessment. Assistance requests connect people on that journey to assignment and completion records.

The dependency is visible in the demo: **review report R104 → direct route excluded → alternative selected → Nav AI explains the source → responder updates assistance progress**.

## Implemented experiences

| Workspace | Flows |
|---|---|
| Citizen iPhone app | Branded welcome; Home; main Map with destination search, report/facility markers and route comparison; Community observations with optional photos; Help requests and progress; Nav AI chat and voice input |
| Responder iPhone app | Overview; incident filtering and assignment; operations Map; community Review; Reports with CSV sharing |
| Responder web app | Preserved G-one operations workspace, community review and a repeatable demo exercise |
| Nav AI | Authenticated MCP retrieval, linked source records, optional generated answers, speech transcription and optional spoken replies |

Account permissions come from server authentication. Selecting a role on the welcome screen does not grant that role.

## Run the iPhone demo on a Mac

Requirements: **Python 3.11+**, **Node.js 22.12+** (or 20.19+), and **Xcode with an installed iOS Simulator runtime**. The app targets iOS 17 or later.

For a fresh checkout:

```bash
git clone https://github.com/ayushkh-txst/waysignal.git
cd waysignal
bash scripts/build-web.sh
bash scripts/run-ios-demo.sh
```

The first script builds the companion web workspace. The second prepares Python dependencies, starts the isolated demo API, builds a signed simulator app and opens it on an available iPhone simulator. It retains local configuration and checks the owner of port 8000 before restarting this project's server.

For subsequent runs, use `bash scripts/run-ios-demo.sh` from the updated project folder. Open `ios/WaySignal.xcodeproj` to inspect the SwiftUI source in Xcode.

| Local demo role | Email | Password |
|---|---|---|
| Citizen | `citizen@example.com` | `CitizenDemo2026!` |
| Responder | `worker@example.com` | `WorkerDemo2026!` |

These are intentional development accounts, unless overridden locally. The native API connection defaults to `http://localhost:8000` for the simulator. The companion web app is served at the same address with a separate sign-in session.

**Keep me signed in** is off by default. Enable it to restore your session from Keychain after relaunch. A compact **Demo data** badge identifies simulated data without covering the app's content.

Build log: `build/WaySignal-build.log`. API log: `build/WaySignal-backend.log`. Environment files, local databases and build products are excluded from Git.

### Separate development servers

```bash
# Terminal 1: populated exercise API and MCP
bash scripts/start-demo.sh
```

```bash
# Terminal 2: web development server
bash scripts/start-web.sh
```

Use the URL printed by Vite, normally `http://127.0.0.1:5173`. For normal development data, stop the demo API and run `bash scripts/start-backend.sh` instead. Demo mode uses a separate `backend/waysignal-demo.db`.

## Demonstration sequence

1. In the responder web workspace, open the exercise and reset the fixtures. Sign in to the iPhone app as the demo citizen.
2. Show Home and Map. Assess the default demo journey and inspect observation **R104**.
3. As responder, confirm R104 as an active hazard with a review note.
4. Reassess the same journey as citizen: the direct candidate is excluded and the alternative is selected.
5. Ask Nav AI why the route changed and open its linked report record.
6. Submit a clearly marked demo assistance request. As responder, assign it, mark en route, then complete it. Show the matching citizen timeline.

Account explains the active simulation; route and source details identify synthetic evidence. Repeated toolbar badges are removed. Map tiles and some inherited integrations still require network access. See the [native guide](docs/NATIVE-UPGRADE.md) and [demo scenario](docs/DEMO-SCENARIO.md).

## Map reporting and shelter navigation

- **Report blocked route** is visible on the citizen Map and Community screens. Choose a photo, preview it, place the observation pin on the map, and submit. Photos are private to the reporter and admins.
- Both native maps read the same `/mobile/map-state` endpoint. Red circles identify reviewed active hazards; amber circles identify pending or stale observations. Circles are conservative report buffers, not measured flood boundaries.
- Green safe points identify currently open, admin-recorded shelter sites. Admins can add and close sites in **Map → Manage safe points & shelters**. Confirmations expire; nearby active hazards suppress green status. No shelters are invented in live mode.
- **Route to shelter** screens up to three nearby recorded open shelters. Flood and blocked-road observations are avoided immediately, including those awaiting review. If all candidates fail, the app offers Help instead of inventing a safe route. The selected candidate includes provider directions when available.
- Reports and map state refresh every eight seconds while the app is active; changed evidence refreshes an existing route assessment. This is polling, not push navigation.
- Nav AI's `find_shelter_route` MCP tool uses the same shelter-selection service as the Map button. General destination comparison retains the earlier review-driven policy; shelter routing applies the stricter closure policy.
- The seeded Hilltop shelter and schematic directions belong to the isolated simulation. Live routing uses OSRM driving routes and recorded shelter confirmations; it is not certified emergency navigation.

## Architecture and MCP

SwiftUI views use focused stores and service clients. REST endpoints and MCP tools call shared domain services, so route decisions follow the same rules in the app and in Nav AI.

- **Single responsibility:** community review, route assessment, assistance and Nav AI retrieval have separate services. Views present state rather than implementing route policy.
- **Open/closed principle:** route providers, report sources and hazard policies are injected behind contracts. `DemoRouteProvider` supplies fixtures through the same contract as the live provider.
- **MCP:** Nav AI uses a real authenticated client/server connection. Its seven read-only tools are `assess_route`, `list_route_reports`, `get_assistance_status`, `get_local_conditions`, `find_nearby_facilities` `list_assistance_requests` and `find_shelter_route`.
- **Authorization:** citizens see their own private assistance records; responder access, photo access and review writes are checked by the backend.

Source: [domain contracts](backend/app/waysignal/domain.py), [route service](backend/app/waysignal/routes.py), [MCP tools](backend/app/waysignal/mcp_server.py), [assistant](backend/app/waysignal/assistant.py). See the [architecture](design/WaySignal-System-Architecture.md) and [implementation handoff](docs/WAYSIGNAL-HANDOFF.md).

### Generated answers and voice

Without a model provider, Nav AI returns labeled **source summaries**. For generated answers, configure `OPENAI_API_KEY` and `GUIDE_AI_MODEL` in the backend's local `.env`, using a model available to your account, then restart the API. Keys stay on the server. Provider failures fall back to source summaries with links.

Voice input requires microphone and speech permission; users review the transcript before sending. **Nav AI → Voice setup** provides permission recovery, a microphone retry, a speaker test and read-aloud controls. Replies are spoken by default and can be muted. The simulator also needs microphone access for Device Hub/Simulator in macOS System Settings. To request fresh app permission prompts without erasing data, run `bash scripts/run-ios-demo.sh --reset-voice-permissions` on the Mac.

**Ask about a picture** attaches a screenshot to a private Nav AI question, with preview and removal. Apple Vision extracts readable text on-device. Without a model key, Nav AI matches that text to app instructions and labels the result; it does not pretend to interpret arbitrary images. With a configured vision-capable `GUIDE_AI_MODEL`, the normalized image is sent to the Responses API with `store: false`. The API format follows [OpenAI’s image-input guide](https://developers.openai.com/api/docs/guides/images-vision). WaySignal does not persist these chat images or publish them as map reports. Image metadata is stripped; oversized or invalid requests are rejected without echoing image content.

**Report hazard** is a separate visible action in Home and Nav AI. It opens the existing photo, hazard type, note and map-pin form. Only an explicit submission creates a shared map report. Community’s **Alerts** filter shows active hazards awaiting review or reviewed active, instead of filtering to the current user's reports. Nav AI reads records and does not submit requests or dispatch responders for the user. A live paid model call has not been verified in this development workspace.

## Reused foundation, new work and future scope

| Origin | Scope |
|---|---|
| G-one foundation | Complete web/backend source snapshot: authentication, maps, contextual data, reporting, requests and responder operations. Original documentation: [G_ONE_README.md](G_ONE_README.md). |
| New WaySignal work | SwiftUI citizen/responder workspaces, walking W branding, reviewed community-to-route workflow, shared domain contracts, authenticated MCP/Nav AI, isolated populated demo, native voice/photo flows and build scripts. |
| Future or incomplete | Native equivalents of every legacy dispatch panel, push notifications, offline synchronization, verified shelter capacity, navigation-grade turn-by-turn guidance and official emergency integrations. |

The baseline is [G-one commit `9e9ebb0`](https://github.com/ayushkh-txst/jalrakshak-hackrice16/tree/9e9ebb009ffcb9ee79f3e80da6bc8401df08f2aa). This repository imports that source snapshot, not the original upstream Git history. Subsequent WaySignal commits separate the new implementation stages.

## Verification

- Latest targeted backend checks: **43 passed** across WaySignal integration and hazard tests, including screenshot privacy/validation, image-provider failure recovery, report-to-map propagation and shelter routing. Earlier full backend regression: **96 passed**.
- Frontend hazard tests: **9 passed**; TypeScript/Vite production build passed.
- Expanded native app: **signed iOS Simulator build passed** on the macOS GitHub Actions runner. [Build result](https://github.com/ayushkh-txst/waysignal/actions/runs/34912217458).
- The earlier native starter also launched on the developer's Mac. The expanded screens still require interaction and visual verification there; compilation does not establish those results. The [iOS workflow](.github/workflows/ios-build.yml) checks subsequent native source changes.

```bash
# From the repository root, after environment setup
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
cd backend
.venv/bin/python -m pytest -q
```

```bash
# From the repository root
cd frontend
npm run test:hazards
npm run build
```

## Submission materials

The source is here. The recorded native demo, final app screenshots and public Adobe Express presentation still need to be added to the submission. Use the supplied event template and identify inherited work, newly demonstrated functionality and future ideas separately.

Design references: [Figma prompt](design/WaySignal-Figma-Prompt.md), [design brief](design/WaySignal-Figma-Design-Brief.md), [mobile concept board](design/WaySignal-Mobile-Design.svg). These are references, not evidence of implemented screens.

WaySignal is a hackathon prototype. Route screening uses reported points and does not certify a route as safe. Assistance requests go to this project's dashboard, not emergency services. There is no verified production deployment in this repository.
