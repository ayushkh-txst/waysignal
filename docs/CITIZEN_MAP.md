# Citizen Live Map

The citizen Live Map uses a street basemap, a toolbar and geographic overlays in the same visual style as the admin operations map. It uses Leaflet with OpenStreetMap street tiles. The admin county dashboard's Google iframe and decorative county overlays are not a data source for this map.

## Behavior and sources

- The initial Houston view is explicitly a preview. It is never labeled as the user's GPS location or submitted as an emergency location. GPS permission is requested by **Use my location**.
- Location names come from backend reverse geocoding. If naming fails, the actual coordinates remain visible. Removed the global text replacement that could label Nepal coordinates as Houston.
- **Reported hazards** uses the existing shared, authenticated hazard feed. **My SOS** and **My responder** show the signed-in citizen's active, non-demo records and their recorded responder coordinates.
- **Nearby facilities** uses the same backend OpenStreetMap/Overpass lookup as evacuation routing. Mapped amenities are candidate destinations: shelter opening, capacity and flood clearance are unverified.
- **Routes** displays screened evacuation routes and any saved responder route for the citizen's own request. Alternative routes can be shown separately. Route analysis is rendered from the current React route state, avoiding stale counters from the legacy DOM enhancer.
- Map polling and layer toggles preserve pan/zoom and the Leaflet instance. GPS changes, a new recommended route, and explicit focus buttons can move the view. SOS polling runs every five seconds while visible and stops on unmount.
- Live route screening uses shared reports by default. The old Houston demo polygons require explicit `includeDemoHazards: true`; they are no longer invisible blockers in citizen or responder live routing. A changed hazard feed invalidates citizen guidance, requiring a fresh route check.
- Failed routing clears the recommendation. Failed feeds show unavailable/stale states, without inventing locations, facilities or routes. A same-position GPS retry still runs routing.

## Backend endpoints

Both new endpoints require an unexpired, signed citizen Bearer token and return `Cache-Control: no-store`.

| Endpoint | Response and access |
| --- | --- |
| `GET /api/v1/citizen-map/places?latitude=...&longitude=...` | Validates finite geographic coordinates. Returns a location label and its source, facilities with OSM IDs and `shelter_verified: false`, retrieval time, radius and provider status. Reverse geocoding and facility lookup run concurrently. A provider outage returns explicit unavailable status or a coordinate label. |
| `GET /api/v1/citizen-map/incidents` | Reads persisted emergency records where `citizen_id` matches the signed token subject, `is_demo` is false, and status is submitted, assigned or en_route. Includes that request's existing responder/navigation fields. Query parameters cannot override the authenticated identity. |

The facility lookup validates provider coordinates, including legitimate zero values. A bounded 90-second in-process cache shares up to 200 location lookups with `/api/v1/routing/evacuation`. No database schema changes or new production dependencies are required.

This endpoint scope does not replace a security review of the older emergency endpoints. Official flood boundaries, road closures and verified shelter feeds remain unconnected. The existing overview demo metrics and admin county prototype overlays are outside this change. Full backend route invalidation and automatic rerouting remain Stage 5.

## Verification

Run from `backend/`, using the existing development environment:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest tests/test_citizen_map.py tests/test_hazards.py -q
```

Run from `frontend/`:

```sh
npm install
npm run test:hazards
npm run build
npm install --no-save --package-lock=false playwright leaflet@1.9.4
npx playwright install chromium
TEST_PYTHON=../backend/.venv/bin/python node tests/citizen-map.browser.mjs
```

The citizen browser test starts Vite and a real FastAPI server using a temporary SQLite database. It uses the real authentication, incident and hazard endpoints, with deterministic external geocoder/facility/road-provider fixtures and test street tiles. It covers private SOS scope, geographic markers, GPS permission failure, place names, route analysis, polling, layer stability, hazard invalidation, same-position retry, provider failure, remount and mobile width. `TEST_PYTHON` must point to Python with backend dependencies; use an absolute path if your virtual environment lives elsewhere. An existing Chromium executable can be supplied with `CHROMIUM_EXECUTABLE_PATH`.

The isolated check passed 34 backend tests, 9 frontend hazard tests, the production build and citizen browser checks. The existing responder map/navigation browser regression also passed with mocked APIs and basemap. Public geocoder and Overpass requests timed out in the execution environment, so these checks do not establish live provider availability or road safety.

## Apply locally

From the existing repository on `feature/login-page-ui`:

```sh
git pull --ff-only origin feature/login-page-ui
```

Restart the backend from this repository's `backend/` folder with its existing virtual environment active:

```sh
python -m uvicorn app.main:app --reload --port 8000
```

Keep the frontend running with `npm run dev` from `frontend/`. Refresh the browser and sign in again if the token has expired. Open **Live Map**, then select **Use my location**.
