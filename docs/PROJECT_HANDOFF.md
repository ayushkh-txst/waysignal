# JalRakshak project handoff

Prepared from the September 12, 2026 implementation session for continuing in a new chat. Read this before changing the project. This is a checkpoint, not a claim that the entire application is finished.

## Start here

**September 13 update:** Citizen street-map integration was pushed in `3e07410`. The subsequent dispatch-assistance change adds worker inbox/popups, location-based sourced contacts, SQL review state and optional AI note extraction. Read [CITIZEN_MAP.md](CITIZEN_MAP.md) and [DISPATCH_ASSISTANT.md](DISPATCH_ASSISTANT.md). Inspect the current branch head before editing. This is an incident notification feature; the removed standalone admin AI chat page is not restored. Optional AI requires backend key/model configuration, while notifications and contacts work without it.

- **Project:** JalRakshak / G-One, a HackRice flood-awareness, citizen assistance, and responder coordination web app. Nepal is the original use case; current local testing uses Houston/Rice University GPS. Do not hard-code all new behavior to either location.
- **Repository:** https://github.com/ayushkh-txst/jalrakshak-hackrice16
- **Working branch:** `feature/login-page-ui`
- **Latest application commit at handoff:** `410254cabc4f3ddf397187ffc88654846cf2091f` — manual GPS filtering in Reports. This handoff is saved in a later documentation-only commit. Always inspect the current branch head before editing.
- **User's Mac checkout:** `/Users/ayushkhadka/Desktop/jalrakshak-hackrice16`
- **Frontend:** React + TypeScript + Vite, in `frontend`, usually http://localhost:5173.
- **Backend:** FastAPI + SQLAlchemy, in `backend`, usually http://localhost:8000; API prefix `/api/v1`.
- **Database:** configured PostgreSQL, with a persistent development SQLite fallback. The user's last observed backend was using SQLite. Preserve existing incident and hazard records.
- **Roles:** citizen UI `/citizen`; admin/responder UI `/responder`. Backend authenticated responder role is named `worker`.

**Immediate next work:** inspect the current branch and implement remaining Stage 5 automatic reroute coordination and citizen/route-change notifications. Worker incoming-SOS alerts and individual review persistence are now implemented; do not duplicate that inbox. Manual Reports GPS and citizen map integration are already implemented. Do not restart Stage 4.

Read [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md) for the older stage history and [REPORTING.md](REPORTING.md) for exact report contracts. Current code and newer user instructions take precedence over this snapshot.

## Working preferences and decisions

- Ayush is working under hackathon time pressure. Be concise, give progress updates during implementation, and carry authorized work through implementation, focused verification, and a concrete deliverable.
- Keep the existing cream/white/olive design, serif headings, current dashboard layout, and larger admin sidebar controls. Figma screenshots guided appearance, not the numbers displayed.
- Admin navigation has five views: **Dashboard, Live Map, Incident Queue, Reports, Settings**. Admin AI Assistant was deliberately removed and must not return. Citizen NavCat and the incident guidance card remain.
- Prefer actual backend records and real provider responses. Identify prototype estimates and unavailable inputs clearly. Do not fill empty metrics with example numbers or claim an unverified route/shelter is safe.
- Do not add placeholder-heavy pages merely to imitate a screenshot. Sparse real data is valid; show the useful recorded counts.
- Give exact terminal names/folders and copyable commands. The user has confused the running frontend and backend terminals before. Prefer two update commands when sufficient; explain additional steps only when needed.
- Do not repeat the complete SOS flow for every UI change. Test the changed behavior in isolation, then give at most the necessary local check.
- Preserve unrelated local changes. Do not reset/clean the checkout, delete databases, use force pushes, or commit dependencies/secrets to resolve routine issues.
- Previous screenshots exposed environment secrets. Do not copy their values into code, documents, or output. Replacing exposed development credentials is a pre-deployment task.
- The established delivery workflow has been focused changes pushed to this branch, followed by short Mac update instructions. Follow the active session's tools and permissions.

## Completed work and evidence

| Area | Implemented | Evidence / limit |
| --- | --- | --- |
| Citizen SOS and incident queue | Persisted requests, assignment, lifecycle/status updates, citizen/responder location and navigation records | User confirmed the existing flow. Do not claim every historical feature was freshly retested. |
| Stage 4 shared hazards | Backend hazard records, authenticated shared reads, GPS/type/time/reporter, optional validated photo, idempotent submission, worker resolve/reopen | User confirmed saved hazards on citizen and responder maps. Isolated API and browser checks passed. |
| Route screening | Citizen and responder routes read the same active hazards; road segments are screened; provider failures do not produce an unscreened recommended fallback | Full automatic coordination after changing hazards is still Stage 5. |
| Responder Live Map | Real Leaflet map, geographic SOS/responder/hazard markers and route lines; focus controls; reported-hazard count and resolve action; demo incidents hidden by default | Replaced the old decorative world-map image. User confirmed the repair. |
| Sidebar | One active view at a time; removed competing navigation handlers; removed admin AI Assistant; enlarged labels/icons/click targets | User confirmed working map/navigation. |
| Operational Reports | Real backend aggregates, filters, charts, GPS groups/quality, response/evacuation records, CSV, polling, loading/empty/stale handling | API and real FastAPI browser checks passed. Demo seeds excluded. |
| Response timestamp collection | First acknowledgment/assignment/dispatch/arrival/resolution and latest citizen GPS receipt fields; explicit acknowledgment action | Nullable additive migration preserves old rows. Historical missing times remain unknown. |
| Sparse Reports display | Active/people/status counts, timing cards only when samples exist, specific missing-time labels, compact data-source notes | Reproduced one old assigned SOS in an isolated browser/database. |
| Manual Reports GPS | Editable latitude/longitude, saved suggestions, Apply/Enter, Clear, draft/applied distinction, UI and API validation, consistent CSV filtering | Latest application commit `410254c`. 9 reporting API tests, browser checks, TypeScript/Vite build passed. |

Important commit checkpoints:

- `af0c2c2`: responder map and single sidebar selection.
- `71715a3`: remove admin AI Assistant.
- `00ce279`: enlarge admin sidebar.
- `4782d02`: Operational Reports API/UI and timestamp tracking.
- `8c3fd47`: useful sparse-data Reports display.
- `410254c`: manual GPS filter.

These are milestones, not instructions to reset to an older commit.

## What the data currently means

- Weather/rainfall and modeled river discharge are requested by the backend from Open-Meteo weather/flood endpoints. The flood input is forecast/model data, not a locally verified gauge observation.
- The application's risk score is a prototype heuristic from environmental inputs. It is not an official emergency warning.
- Nearby facilities use OpenStreetMap/Overpass and road routing uses OSRM. A facility result is not confirmation that a shelter is open, staffed, safe, or has spare capacity.
- User hazard reports are unverified reports with GPS and optional photos. They persist until a responder changes their status; an attachment is not itself proof of a hazard.
- Admin county Dashboard still contains hybrid/modeled context, including county figures and safe-zone/responder examples. It has **not** been converted to all-real data by the Reports work. See `api/admin-dashboard.api.ts` before making claims about it.
- Reports uses persisted, non-demo SOS incidents. Test SOS requests submitted through the normal live form still count. Seeded `is_demo=true` records do not.
- At the user's last report screenshots there was one old assigned SOS, no recorded historical action times, and no matching evacuation or resolved records. This explained the zero counts and unavailable timing averages. Do not create or reassign incidents solely to make charts look populated.
- Reports GPS matching uses the stored coordinates rounded to three decimals. Manual entry filters those groups; it does not move the citizen, fetch unrelated disaster records, or search an arbitrary radius.
- Shelter capacity/check-ins, alert delivery receipts, offline sync analytics, and verified administrative membership are not yet connected in Reports. Those sections were removed from the main report views and their limits documented.
- There is no completed satellite/ML flood detection pipeline merely because the original idea proposed one.

## Remaining work, in practical order

Stage 5 is the established next milestone. The numbered items below are a working completion sequence, **not a recovered verbatim list of the old Stages 6–20**. Later stage numbering was not fully preserved in the available tracker. Keep this backlog updated as scope changes.

### 1. Stage 5: automatic rerouting and notifications

Build on existing hazard polling, route screening, stored responder route/ETA fields, and citizen invalidation hooks.

- Detect relevant changes: a new/changed/resolved hazard affecting an active route, a materially changed GPS position, and route/screening failures or expiry.
- Recalculate and screen a real road route, and persist the resulting route/ETA/status and the reason/time for the change. Reuse existing contracts where possible; inspect them first.
- Prevent duplicate recalculations, repeated alerts, and older requests overwriting newer results. Keep map pan/zoom and active incident selection stable.
- Notify the affected citizen/responder within the application with persistent event IDs and read state. Distinguish an event being saved, delivered to a client, and read; do not invent delivery receipts.
- Show a clear unavailable/no-viable-route state on service failure. Existing safe behavior must remain.

Done when: an isolated route affected by a test hazard updates in both roles; a distant irrelevant hazard does not trigger unnecessary action; resolution permits a fresh screen; reconnect does not duplicate notifications; stale/out-of-order calculations cannot replace newer ones; provider failure is represented honestly.

### 2. Close the remaining operational data gaps

- Audit county Dashboard modeled metrics against available backend records. Replace only where real data exists; otherwise keep the limitation visible or omit the metric.
- Use authoritative administrative boundaries before claiming exact district/county membership. The current nearest-center heuristic and rounded GPS groups are not boundary validation.
- Connect official alerts/hazards or gauge feeds appropriate to the selected geography if feasible, with source and freshness. Verify actual API availability and terms before implementing.
- For shelter occupancy/assignment, first establish a real facility source plus capacity/check-in or operator update workflow. Do not infer occupancy from routing destinations.
- Add alert and shelter reporting only after those events/data are actually persisted. Keep same filters and source definitions across views and exports.

### 3. Finish the citizen journey and responder coordination

- Review citizen NavCat text/voice actions against real SOS, route, hazard, weather and notification APIs. Handle incomplete GPS, misunderstood speech, and provider failure without unsupported claims.
- Verify start-guidance, cannot-evacuate/SOS, responder updates and arrival/resolution handoff once as a complete journey after Stage 5.
- Audit dispatch/prioritization and responder availability against real records. Avoid invented units, duplicate assignment, and inconsistent statuses.
- Keep admin AI Assistant out of scope. Missing-person or other original idea features remain backlog until their storage/API/workflow is actually implemented.

### 4. Reliability and security needed before a public deployment

- Validate permissions on existing emergency read/write/navigation endpoints. New Reports/hazard protections do not prove every legacy endpoint is secure.
- Replace exposed development secrets and remove production dependence on permissive/demo authentication. Handle session expiry and reconnect gracefully.
- Ensure one authoritative persistent database, safe migrations, configured CORS, environment variables, and a reproducible dependency installation. Several dependencies still use `latest`; inspect the lockfile before changing versions.
- Add bounded provider timeouts/retries and explicit stale/offline states. Offline request queuing requires idempotent IDs and actual sync events before claiming offline analytics. SMS/push is optional until a provider is configured.
- Keep any optional offline/PWA or notification-provider work separate from the core demo path so incomplete integrations do not break it.

### 5. Finish and demonstrate the project

- Run focused regression suites and one final citizen-to-responder journey on the deployment target with separate role sessions.
- Validate responsive layouts, keyboard interactions, error/empty states and export results. Verify counts against database/API responses.
- Prepare a stable demonstration sequence: context/GPS → SOS → assign/respond → hazard → reroute/notification → resolve → Reports.
- Keep isolated demo fixtures clearly marked. Resolve test hazards when finished so they do not continue affecting routes. Do not present simulated incidents as a real emergency.
- Prepare README/setup, architecture/data-source summary, known limits, screenshots or a short backup demo recording, and hackathon submission materials.
- Deploy only to the user's chosen/authorized target after configuration and data handling are ready. Do not switch this existing repo into Sites unless explicitly requested.

For a tight deadline, prioritize Stage 5 plus a stable, honest demonstration and essential security fixes. Official shelter occupancy, sophisticated ML/satellite ingestion, SMS and a mobile app can remain clearly documented later work. Do not promise an exact completion time before reviewing scope and provider access.

## Files to inspect next

| Purpose | Paths relative to repo |
| --- | --- |
| Emergency records, status, navigation, ETA and timestamps | `backend/app/api/v1/emergencies.py`, `backend/app/core/database.py` |
| Hazard API and permissions | `backend/app/api/v1/hazards.py` |
| Routing and environmental providers | `backend/app/api/v1/routing.py`, `backend/app/api/v1/safety.py` |
| Shared hazard client and route screening | `frontend/src/features/dashboard/api/hazards.api.ts`, `api/route-screening.ts` under that dashboard directory |
| Citizen/responder API contract | `frontend/src/features/dashboard/api/citizen-safety.api.ts` |
| Existing route and lifecycle hooks | `frontend/src/features/dashboard/responder-routing-enhancer.ts`, `responder-lifecycle-enhancer.ts`, `route-analysis-enhancer.ts`, `command-center-enhancer.ts` |
| Map mounting and active admin view | `frontend/src/features/dashboard/pages/ResponderOperationsMap.tsx`, `pages/WorkerDashboard.tsx` |
| Citizen actions, hazards and alerts | `frontend/src/features/dashboard/navcat-action-engine.ts`, `navcat-hazard-report-enhancer.ts`, `user-hazard-map-enhancer.ts`, `alerts-enhancer.ts` |
| Reports | `backend/app/api/v1/reports.py`, `frontend/src/features/dashboard/api/reports.api.ts`, `pages/OperationalReports.tsx`, `pages/OperationalReports.css` |
| Hybrid Dashboard data | `frontend/src/features/dashboard/api/admin-dashboard.api.ts` |

The frontend mixes React and legacy imperative enhancers. Reuse the existing owner of each view, avoid introducing competing navigation listeners or duplicate polling, and preserve cleanup on unmount.

## Local updates and verification

For ordinary updates, in the user's **frontend terminal**, stop Vite with Control+C and run one at a time:

```sh
git pull --ff-only origin feature/login-page-ui
npm run dev
```

These assume the terminal is already in `frontend`. If it is at the repo root, first run `cd frontend`. Run `npm install` only when dependency changes require it. Keep the backend running; `--reload` picks up Python changes. If a restart is needed, stop the existing backend first, then run from this checkout's `backend` with its virtual environment active:

```sh
python -m uvicorn app.main:app --reload --port 8000
```

Avoid the older separate `/Desktop/jalrakshak-backend` checkout seen in an editor breadcrumb. The selected project is `jalrakshak-hackrice16`. The previous terminal list had **Backend backend** as the second entry and frontend **node frontend/zsh** as the third, but inspect the current screenshot rather than assuming names never change.

If port 8000 is occupied, identify/stop the existing backend rather than launching duplicates. A successful startup says `Application startup complete`; a PostgreSQL-unavailable SQLite warning is a separate development database choice. If Git pull reports a conflict, inspect it and preserve work.

Relevant isolated checks:

```sh
# backend, with development test dependencies installed
python -m pytest tests/test_reports.py tests/test_hazards.py -q

# frontend
npm run build
npm run test:hazards
```

- Latest GPS follow-up: **9 reporting API tests passed**, plus real FastAPI/temporary SQLite browser checks and the TypeScript/Vite 8.3.0 production build.
- Earlier hazard work: **20 backend hazard tests** and **9 frontend hazard tests** passed. Do not describe these as newly rerun unless you run them again.
- `frontend/tests/reports.browser.mjs` starts an isolated backend/frontend, uses real report/auth/CSV/emergency HTTP requests, and deletes its temporary database. Includes manual GPS validation/precision/clear/no-match cases and sparse legacy data.
- `frontend/tests/responder-map.browser.mjs` exercises real React/Leaflet behavior with mocked map/API/GPS providers. This is not an external provider uptime test.
- Browser scripts require Playwright/Chromium test tooling; see `REPORTING.md`. Test runtimes previously used Python 3.12, whereas the user's Mac has shown Python 3.14. Do not claim the user's machine or production PostgreSQL was exercised by isolated checks.

## Continuity and next-session procedure

1. Read this handoff and reporting definitions, then inspect the latest remote branch and local changes. Check for applicable repository instructions.
2. Use a fresh valid checkout/worktree when needed. The prior chat's scratch copy `jalrakshak-stage4` was assembled over an older local Git snapshot and is not a reliable remote commit ancestry. Do not blindly commit all its staged/untracked files. Previous updates used selected GitHub blobs/trees/commits against the verified remote parent with non-force ref updates.
3. Inspect current Stage 5 hooks and build the smallest complete missing behavior. Briefly explain any material gap before broadening scope.
4. Test that behavior in an isolated database/browser, publish only intended files through the authorized workflow, and give short update steps.
5. Update this handoff/tracker after each completed milestone, including commit, checks actually run, known limits, and the next task.

Code and this handoff are stored in GitHub. The user's local database, browser sessions, terminal processes, and uncommitted Mac edits are separate; a new chat must not claim they were copied into GitHub. The new chat may need repo access or this file attached. Use this document as explicit context rather than relying on automatic recall of the entire conversation.
