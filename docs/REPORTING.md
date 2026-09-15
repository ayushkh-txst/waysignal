# Operational Reports

The Reports page reads saved operational data from the project's backend. Reference-design numbers are not copied into the product. A fresh installation can legitimately show zero incidents or unavailable measurements.

## Sparse and older records

The summary shows six recorded counts: total incidents, active incidents, people in active incidents, resolved incidents, people in resolved incidents, and critical prototype risk snapshots. Response shows current status counts from the API even when older records have no timestamp history. Average-time cards appear only for milestones with usable recorded samples. A compact explanation replaces empty timing cards when there are none.

Incident tables distinguish **Not assigned**, **Not resolved**, and **Time not recorded**. An old assigned incident retains its known status while its original assignment time stays unknown. Do not reassign incidents or create requests simply to populate a report.

Evacuation zeroes mean no matching evacuation requests; a rescue request does not count as evacuation. Unconnected alert delivery, shelter occupancy, and offline sync sections are omitted from the main reports and listed under **Data sources and missing measurements**. GPS quality uses actual unknown-quality counts instead of an unimplemented offline counter. These display changes do not add the missing data collection integrations.

The browser check also isolates one older assigned SOS without timestamps, matching the sparse-data condition seen during local use, and verifies known status counts, missing-time labels, mobile layout, and the transition back to populated timing metrics. It uses temporary test data only.

## API

Both endpoints require a valid signed `worker` token (the role used by the admin interface):

- `GET /api/v1/admin/reports`: aggregates plus 25 incident rows per page.
- `GET /api/v1/admin/reports/export`: CSV of every matching incident, independent of pagination.

Shared filters: `start_date`, `end_date` (inclusive local calendar dates); `timezone_name` (IANA zone, defaults UTC); `severity` (critical/high/moderate/low/unknown); `incident_type` (rescue/medical/evacuation); `status` (submitted/assigned/en_route/resolved/cancelled); `location` (GPS group returned in the response); `page` (1-based). Maximum range is 93 days. Default is seven days through today. Future end dates and invalid ranges return 422. Both endpoints send `Cache-Control: no-store`.

Records are selected by creation date. Future-dated records and seeded `is_demo=true` incidents are excluded. Status, GPS and risk use the latest stored row, so this is a cohort report, not a historical end-of-day reconstruction. A test SOS submitted through the ordinary live form is still a non-demo database record and is included.

### Manual GPS filter

Type decimal **latitude, longitude** into GPS location (for example `29.71799, -95.40200`) or choose a saved-location suggestion. Click **Apply** or press Enter. **Clear** returns to all locations; entering an empty value and applying does the same. Editing the field does not change the report until applied, and a pending-edit message makes clear which filter exports use.

The report and CSV endpoints validate latitude in [-90, 90] and longitude in [-180, 180], then normalize to the same three-decimal GPS groups used for saved incidents. Extra spaces and decimal precision are accepted; malformed/out-of-range coordinates return 422. Negative zero is normalized consistently. This filters existing saved records and does not change a citizen's location or perform a radius search. A valid coordinate without matching records returns zero incidents.

## Metric definitions

| Display | Calculation / limitation |
| --- | --- |
| Total incidents | Count of matching non-demo records, including cancellations unless filtered out. |
| Critical risk snapshots | Stored prototype risk score ≥80. High ≥60, moderate ≥35, low below 35; missing score is unknown. These are not official emergency severity ratings. |
| People in resolved incidents | Sum of reported group sizes where current status is resolved. This is not a verified rescue count and does not deduplicate people across requests. |
| Resolution percentage | Resolved records divided by all matching records. No denominator produces null, not a fictitious percentage. |
| Average milestone time | Mean seconds from creation to each first recorded action, with sample count. Missing, negative or future durations are excluded. |
| Location summary | Latest coordinates rounded to three decimals, roughly a 100 m group near the equator. These are explicitly GPS groups, not inferred district/county membership. |
| Location risk | Maximum stored incident risk score within each GPS group, not a current regional forecast. |
| Location quality | Matching active requests only. Stale if last GPS receipt is over 300 seconds old; fresh accuracy ≤25 m is high, ≤100 m medium, >100 m low. Missing freshness or fresh-but-missing accuracy is unknown. |
| GPS freshness | Time the backend received the last citizen location update. It does not certify the sensor's fix time or refresh when a responder updates navigation. |
| Average GPS accuracy | Mean of available accuracy estimates for the matching active records, including stale records; sample count is shown. |
| Evacuation | Counts and reported group sizes of evacuation requests. Does not imply shelter arrival or successful transport. |
| Shelter, offline, delivery | Unavailable until capacity/check-ins, offline sync events, and alert delivery receipts are recorded. |

## Recording response times

Startup adds six nullable timestamp columns to existing emergency tables. Existing incident rows are preserved; no historical action times are invented. New SOS creation and `/location` updates record `location_updated_at`. The existing status/navigation endpoints record first assignment, dispatch, on-scene and resolution actions. Going directly to on-scene does not fabricate a dispatch time. Repeated writes preserve the first milestone.

`POST /api/v1/emergencies/{id}/acknowledge` requires a signed worker token and records the first explicit acknowledgment. The incident queue has a new Acknowledge button. Assignment also acknowledges the request. For an older already-assigned incident, its original assignment remains unknown. SQLite's naive stored UTC timestamps are serialized with a timezone to avoid incorrect browser-local ages.

New reporting and acknowledgment endpoints are role-protected. This change does not claim to finish the separate security review of pre-existing emergency mutation endpoints or the application's demo login repository.

## Local update

From the repository root:

```sh
git pull --ff-only origin feature/login-page-ui
```

In the existing backend terminal, stop the server with Control+C and run from this checkout's `backend` directory with its virtual environment active:

```sh
python -m uvicorn app.main:app --reload --port 8000
```

Wait for `Application startup complete`. Startup applies the additive schema update. Stop the frontend with Control+C, run `npm install` from `frontend` to add the React type declarations, then `npm run dev`. Refresh the admin browser, sign in if the token expired, and choose Reports. The supplied environment previously used persistent development SQLite; a configured PostgreSQL server uses the same models and timezone-aware new migration columns.

## Verification

Run backend tests in an isolated database:

```sh
# backend/
python -m pip install -r requirements-dev.txt
python -m pytest tests/test_reports.py tests/test_hazards.py -q
```

Build and check existing hazard behavior:

```sh
# frontend/
npm install
npm run build
npm run test:hazards
```

`tests/reports.browser.mjs` starts real FastAPI and Vite servers on isolated ports, creates a temporary SQLite database, uses the actual login/report/CSV/emergency endpoints, and deletes the database afterward. Its incident fixtures are explicitly test data. It never reads or changes the user's development database. Install Playwright as test tooling first; application dependencies are unchanged:

```sh
# frontend/ — optional browser test tooling
npm install --no-save --package-lock=false playwright
npx playwright install chromium
TEST_PYTHON="$PWD/../backend/.venv/bin/python" node tests/reports.browser.mjs
```

Use an absolute `TEST_PYTHON` path if your shell resolves executables relative to the child process working directory. `TEST_BACKEND_DIR` can point to another checkout, and `CHROMIUM_EXECUTABLE_PATH` can select an existing browser binary.

Coverage: backend aggregate/filter arithmetic, demo/unknown handling, CSV beyond pagination, roles/invalid input, timezone/DST date edges, persistent/idempotent milestones and migration preservation. Browser coverage: real API totals, combined filters, empty state, CSV download, all Reports tabs, GPS group filter, live polling after creating an incident, report-to-queue navigation, acknowledgment and assignment writes, desktop/mobile overflow checks, stale state after deliberately stopping the backend, and runtime errors. Existing responder map/sidebar tests continue to cover navigation and Leaflet mounting separately with mocked map providers.

Validated here with Python 3.12, temporary SQLite, Vite 8.3.0 and headless Chromium. This is not a claim that production PostgreSQL, external weather/routing providers, or the user's Mac were exercised in this environment.
