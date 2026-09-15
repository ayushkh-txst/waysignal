# Admin dispatch alerts

Live citizen requests now appear in a worker-only dispatch inbox. The sidebar bell is available on every admin view, and a popup shows the newest unreviewed request with location-matched contacts. The original fixed AI Guidance message is replaced by **Open dispatch assistance** in the incident panel.

## Request workflow

1. The citizen submits the existing SOS form. The emergency is saved before it can enter the notification feed.
2. Every five seconds while the app is visible, the worker inbox reads active, non-demo requests from the backend. It shows a request summary, reported GPS and suggested service categories based on the selected request type. This is a factual summary, not clinical triage or an AI urgency rating.
3. The assistant resolves the incident's coordinates to a country/city and selects contacts from a sourced directory. The admin can open an official source, open a dialer, or copy a handoff containing the actual request details.
4. **Mark reviewed** stores that worker's review in SQL. It does not acknowledge the incident for everyone, assign a responder, confirm a phone call or dispatch emergency services.
5. A material report change becomes unread again. The revision includes request type, people count, note, recorded risk level, and GPS rounded to three decimals (roughly 100 metres latitude). Routine responder/navigation heartbeats do not replay notifications. Exact coordinates are always used for contact lookup and shown on screen.

Initial sign-in can show the newest pending request. Dismissing the popup only hides it for the current session. Other unread requests remain in the inbox. Reviewed state survives refresh/restart and is separate for each worker. Resolved, cancelled and seeded demo requests are excluded. Up to 2,500 active requests are supported; larger feeds return an explicit error.

These are in-app notifications. They require an authenticated, open browser session and are not push notifications, SMS, automatic calls or a public-safety dispatch integration. A hidden tab pauses polling and refreshes when visible again. Backend/feed errors show an unavailable state and remove actionable contacts from the open inbox until it refreshes.

## Contacts and geographic scope

Directory sources were checked on **2026-09-13**. Each card includes the source URL and that date. These are published contacts, not a live availability or jurisdiction-boundary feed.

| Scope | Published contact | Source |
| --- | --- | --- |
| United States | 911 for emergency dispatch, including ambulance, fire and police | [National 911 Program](https://www.911.gov/calling-911/frequently-asked-questions/), [Houston emergency guidance](https://www.houstontx.gov/police/contact/911.htm) |
| Houston city, Texas | +1 713 884 3131, explicitly labeled non-emergency police coordination | [Houston Police contact page](https://www.houstontx.gov/police/contact/) |
| Nepal | Ambulance 102; fire brigade 101; police control 100 | [US Department of State Nepal information](https://travel.state.gov/en/international-travel/travel-advisories/nepal.html), [Nepal Police](https://nepalpolice.gov.np/stations/emergency-contacts/) |
| Kathmandu Metropolitan City | +977 9851356509, municipal police control room | [Kathmandu Metropolitan City](https://kathmandu.gov.np/en/contact) |

For US incidents, one 911 entry covers multiple service categories. The interface explains that a short code routes according to the caller's location/network, not the incident's map pin. An admin calling about another jurisdiction must verify its local coordination contact. The [National 911 Program](https://www.911.gov/calling-911/frequently-asked-questions/) specifically addresses calls about emergencies in another city or state.

Country and city are taken from backend reverse geocoding, never inferred from notes or an AI response. Unknown/unconnected locations receive no guessed number. On lookup failure, coordinates remain visible and the admin can explicitly browse the US or Nepal directory. This choice is labeled manual, does not change the saved GPS, does not enable city-specific contacts, and resets when the report location changes. Geocoded city names are not proof of legal service boundaries; the cards ask the admin to confirm jurisdiction. Nepal service availability varies by area. No dedicated rescue team's capability or availability is asserted.

## Optional AI note review

Alerts, request summaries, service categories and contact lookup work immediately without an AI key. For model-based note review, configure both values in the backend's local `.env` and restart the backend:

```dotenv
OPENAI_API_KEY=your-own-api-key
DISPATCH_AI_MODEL=your-supported-model-id
```

Choose a model available to your API account that supports [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). This implementation uses the HTTPS API through existing `httpx`; no new production package is required. Never put the API key in frontend/Vite configuration or commit the local `.env`.

When configured, opening a notification review automatically extracts explicitly mentioned support needs from its citizen note; the admin can retry manually. The output schema contains only predefined support categories and exact evidence excerpts. The backend validates the schema and requires evidence to occur in the submitted note. Numbers, contacts, urgency, responder assignment and dispatch decisions are outside the AI schema. Model failure/refusal/invalid output leaves the original report and verified directory usable. No key or model configuration means the UI says AI is not configured, rather than presenting template text as a model response.

The model receives the note with phone-like strings, emails and URLs redacted. Separate identity/GPS fields, photos and the directory are not sent. Free-text notes may still contain personal information. Requests use `store: false`. AI results are not medical assessment or verified facts; the admin reviews the evidence against the original note. Results are cached in process for five minutes for an incident/revision, with at most four concurrent model requests. Multi-process rate limiting and organization-specific data governance remain deployment work.

## API and persistence

All endpoints below require a valid signed `worker` Bearer token and return `Cache-Control: no-store`:

| Endpoint under `/api/v1/admin/dispatch` | Purpose |
| --- | --- |
| `GET /notifications` | Active request briefs, revision, reviewed flag, unread count and server check timestamp |
| `GET /incidents/{id}` | Current request, location, official contacts, GPS age/accuracy and copyable handoff; optional `?directory=US` or `NP` for manual browsing |
| `POST /incidents/{id}/review` | Save this worker's review; body `{"revision":"..."}` must match the current report |
| `POST /incidents/{id}/ai-review` | Optional AI extraction for the requested revision; returns explicit configured/unavailable/complete status |

New table `dispatch_reviews` is created by existing startup without resetting emergency records. Worker ID comes from the signed token. Unknown/demo IDs return 404; closed requests and stale revisions return 409. Contact lookup checks again after the external request so a concurrent GPS change cannot return contacts for the old point. Missing or older-than-five-minute GPS receipt times are flagged for confirmation.

The existing emergency create/list/update endpoints are outside this endpoint authorization change and still need the previously documented security review. There is no public-safety account connection, verified dispatch receipt, collected citizen callback field, official resource inventory or global contact coverage in this feature.

## Run and verify

Pull `feature/login-page-ui`, restart the existing backend from this repository's `backend/` folder, and keep the frontend running. Startup adds the review table. No destructive migration is needed.

```sh
# backend/, existing virtual environment active
python -m pytest tests/test_dispatch.py tests/test_citizen_map.py tests/test_hazards.py -q
python -m uvicorn app.main:app --reload --port 8000

# frontend/, another terminal
npm run build
npm run test:hazards
npm run dev
```

The dispatch browser test starts its own Vite/FastAPI processes and temporary SQLite database. Stop other servers using the test ports before running it, install the same browser-test tooling documented in `CITIZEN_MAP.md`, then from `frontend/` run:

```sh
TEST_PYTHON=/absolute/path/to/backend/.venv/bin/python node tests/dispatch.browser.mjs
```

Verification covers real citizen form submission through API/SQL into an admin notification, worker authorization and review isolation/persistence, country/city contacts, lookup and feed outages, stale revisions, GPS changes, closed/demo exclusions, failed-write retry, note escaping, model schema/evidence validation, mobile fit and incident navigation. Browser geocoding, weather and AI use deterministic fixtures; no emergency number is dialed and no live model inference or dispatch availability is certified. The combined backend suite has 52 passing tests; frontend hazard tests have 9 passing cases.
