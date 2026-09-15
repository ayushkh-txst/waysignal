# WaySignal demo scenario

This update adds a repeatable exercise to the existing WaySignal codebase. Account and route/source details identify this mode as synthetic. It uses a separate local `backend/waysignal-demo.db`; normal development data and yesterday's G-one folder are preserved.

## Start on your Mac

1. Stop the **backend** terminal (the one showing Uvicorn on port 8000) with Control-C. Leave the Vite terminal running.
2. Apply the downloaded `WaySignal-Demo-Update` package by running:

   ```bash
   bash ~/Downloads/WaySignal-Demo-Update/apply-update.sh
   ```

   The default target is `~/Downloads/waysignal`. If you moved your project, pass its folder as the script's first argument. The installer checks the patch first and saves a backup beside the project. If it reports a conflict, keep that output; it has not applied the patch.
3. In the backend terminal run:

   ```bash
   cd ~/Downloads/waysignal
   bash scripts/start-demo.sh
   ```

4. Refresh `http://127.0.0.1:5173`. Sign in, then click **Open exercise** in the amber **DEMO SCENARIO** banner. If Vite is stopped, start it in a separate terminal with `bash scripts/start-web.sh`. The included production web build can also be opened at `http://localhost:8000`.

Default development accounts, unless you changed their configuration:

| Role | Email | Password |
|---|---|---|
| Citizen | citizen@example.com | CitizenDemo2026! |
| Responder | worker@example.com | WorkerDemo2026! |

Use separate browser windows/profiles for the two roles. Reloading currently requires signing in again because the inherited web session is held in memory.

## What is populated

- Five community observations: two awaiting review, two reviewed active, and one resolved.
- Five schematic route candidates with simulated distances and travel times.
- Four fictional facilities in the map data endpoint.
- Six assistance requests across submitted, assigned, en-route and resolved states. The demo citizen can see their four requests; the responder can see all six.
- Synthetic rain, river trend and risk context; operational reports calculated from these saved exercise records.
- Guide explanations retrieved through the actual MCP client/server and the same route policy service used by REST.

The new exercise page is the reliable presentation flow. The native app loads the exercise origin, destination, reports, requests and route assessment after login, with simulation information in Account and source details. Native compilation and simulator testing still require Xcode on your Mac. Basemap tiles and inherited external-service features may require connectivity. Shelter capacity, alert delivery analytics and other unconnected modules are still unimplemented; the exercise does not claim to make those integrations real.

## A 90-second demonstration

1. Open Map → Route to shelter. The initial selected route is the outer northern corridor (route 4); the direct, inner northern and southern corridors are excluded by R104, R105 and R101.
2. Submit an obstruction at **27.7206, 85.327**, on the selected corridor. The shared route assessment changes to the outer southern corridor (route 5) before review.
3. Confirm the report as active as admin; the route stays excluded. Resolve or reject it to make that corridor eligible again.
4. Open Nav AI and ask why the route changed. Its MCP-backed answer refers to the same records and route service.
5. Open assistance request H208 as admin. Simulator directions load from the explicitly named Riverside response base to Arun's request location. Device GPS and manually chosen points use the road provider instead.
6. Assign and complete a request. Its progress does not clear road reports.
7. Reset only if you intend to restore fixture statuses before another presentation. Reset replaces fixed fixture IDs and preserves custom records. Updates do not reset the database.

The exercise is grounded at fixed coordinates near Kathmandu for continuity with G-one. Place names, people, weather and route lines are fictional. Lines are schematic and are not actual driving directions. Real-location queries outside the exercise area return a clear error.

## Return to live data

Stop the backend with Control-C, then run `bash scripts/start-backend.sh` and refresh the web app. Demo environment variables are scoped to the demo launcher process. The normal development database returns. Do not put `WAYSIGNAL_DEMO_MODE=true` into your normal `.env`.

## Architecture and validation

`DemoRouteProvider` implements the existing route provider contract. Seeding and fixture definitions live in `backend/app/waysignal/scenario.py`; shared route policies, review authorization and MCP services retain their responsibilities. Native `ScenarioStore` and web `ScenarioProvider` consume the server's mode endpoint before showing the app. Development CORS accepts localhost and 127.0.0.1 on ports 5173 and 8000; production retains its configured origin.

Validation: the existing 88 backend tests passed, plus four new scenario tests. Existing frontend tests: 9 passed. Production web build passed. A real-server React DOM integration check exercised population, review, route change, actual MCP Guide, assignment, reset and operational-report totals. Modified Swift files passed a syntax parser; no Xcode build or visual simulator verification was available in this environment.

For judging, distinguish inherited G-one features, newly built WaySignal interactions and future features. Use the supplied Adobe Express template for the storytelling submission, including app screenshots and a short demo recording.
