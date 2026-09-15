# WaySignal

**Know the route. Share the signal.**

Navigation × Social Media × Productivity: a community observation becomes a responder review, changes a route assessment, and connects people to recorded assistance progress.

This new local repository preserves the complete G-one source snapshot from `ayushkh-txst/jalrakshak-hackrice16` at `9e9ebb009ffcb9ee79f3e80da6bc8401df08f2aa`. The upstream commit history is not imported. The original README is preserved in [G_ONE_README.md](G_ONE_README.md).

## Native app upgrade

Read [the native update guide](docs/NATIVE-UPGRADE.md) for the new icon, welcome screen, citizen and responder workspaces, voice/chat Guide, installation and demo recording. Run `bash scripts/run-ios-demo.sh` for the local demo API and a signed iPhone Simulator build.

## Run on your Mac

Requirements: Python 3.11+, Node.js 22.12+ (or 20.19+), and Xcode with the iOS 17+ SDK.

```bash
# Terminal 1 — API, MCP and local SQLite
bash scripts/start-backend.sh
```

```bash
# Terminal 2 — complete G-one web app + new responder review page
bash scripts/start-web.sh
```

```bash
# Open the native app; select an iPhone Simulator and press Run
open ios/WaySignal.xcodeproj
```

The native login defaults to `http://localhost:8000`. The web app opens at `http://localhost:5173`. Use the inherited local demo accounts configured in `backend/app/core/config.py`. Do not use a production account for the demonstration.

The downloadable ZIP includes the built web application, which the API serves at `http://localhost:8000`. After editing web source, run `bash scripts/build-web.sh` to refresh that build. A source-only Git checkout needs this build before the native **Open full web application** link is available. The separate Vite development server on port 5173 is available without that build. Browser sign-in is separate from native sign-in.

## What is included

- **All G-one modules** in the original frontend/backend layout: citizen maps, weather/flood context, alerts, facility lookup, hazard/photo reporting, AI/voice modules, emergency requests, responder maps, assignment, navigation, dispatch and operational reports.
- **Native SwiftUI source:** branded welcome, citizen Home/Map/Community/Help/Guide, and responder Overview/Incidents/Map/Review/Reports; search, photo observations, review, assignments, timelines, voice/chat and CSV export.
- **Responder Community Review:** evidence, notes, reviewed/rejected decisions, resolve/reopen, history and conflict handling.
- **Shared backend services:** one route-assessment implementation behind REST and MCP, with independently injectable route providers, report sources and hazard policies.
- **Real MCP:** six authenticated route, report, assistance, forecast and facility tools. Guide retrieves source records and optionally generates an answer using a configured server-side model.
- **Figma handoff:** complete prompt, tokens, components, screen specifications, SVG reference boards and award presentation story.

All G-one functionality remains available on the web. The expanded native app covers the flows listed in the update guide. Additional legacy dispatch panels remain in the web workspace. Native Guide supports typed and voice input; generated answers require a configured server-side provider and otherwise show source summaries.

## Verification

- Backend: **96 tests passed** (including new assistant and observation contracts).
- Existing frontend hazard tests: **9 passed**.
- TypeScript/Vite production build: **passed**.
- Expanded iOS build and new-screen behavior: **requires verification on the Mac**. The earlier starter compiled and launched there; this development workspace has no Xcode.

```bash
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

```bash
cd frontend
npm run test:hazards
npm run build
```

On your Mac:

```bash
xcodebuild -project ios/WaySignal.xcodeproj -scheme WaySignal \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ENTITLEMENTS_REQUIRED=YES build
```

## Demo and submission

Read [the implementation handoff](docs/WAYSIGNAL-HANDOFF.md) for the demo sequence, API contracts, service boundaries and remaining work. Copy [the Figma prompt](design/WaySignal-Figma-Prompt.md) alongside the [complete design brief](design/WaySignal-Figma-Design-Brief.md). Assemble the storytelling submission in the supplied Adobe Express template.

The core demonstration is **report → responder review → changed route assessment → assistance assignment → source-linked explanation**. Mark inherited work, new hackathon work and future features separately.

This is a hackathon prototype. Reviews are project reviews, route screening uses reported points, and no route is certified safe. Prototype assistance requests go to the project dashboard, not emergency services. No public repository or deployment has been created yet.

## Populated demo exercise

Start `bash scripts/start-demo.sh` instead of the normal backend launcher, sign in, then click **Open exercise**. Read [the demo instructions](docs/DEMO-SCENARIO.md) for installation, default accounts, reset and the presentation sequence. The exercise adds isolated synthetic reports, assistance requests, weather and route candidates.
