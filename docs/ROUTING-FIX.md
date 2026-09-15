# Obstacle avoidance and request directions

The previous shelter policy omitted pending `debris` reports from its blocking types. That let the north corridor remain green even though R105 lay directly on it. The general journey endpoint also used a less conservative policy than shelter and admin routes.

## Resulting behavior

- One shared policy now excludes active flood, road-blocked and debris reports before review, including stale reports that have not been resolved. Review status remains visible separately.
- Screening checks every line segment against the same 120 m flood / 60 m other-hazard buffers shown on the map, expanded for reported inaccuracy up to 250 m. It does not simply check route vertices.
- The isolated Riverside scenario includes two additional outer corridors. Initial shelter selection avoids all three obstructed inner candidates; blocking the selected outer corridor selects the other. Every candidate is screened, and all-blocked results have no selected route. Existing hazards are never deleted, moved or resolved to make a route pass.
- Shared map changes trigger route reassessment. A change during an in-flight request queues another assessment and prevents the outdated result from drawing a line.
- Admin request directions in the simulator open from **Riverside response base**, explicitly named above the map. The request endpoint resolves the destination from the selected assistance record and still checks authorization and concurrent location changes.
- **Use my location** acquires GPS separately. A temporary unavailable-location error is retried twice. If it fails, the existing route from its labelled origin remains visible and a readable recovery message replaces the raw CoreLocation error. Manual and device origins continue to use the live road provider. **Refresh directions** retries the chosen origin.

## Mac verification

1. Apply the update and sign in as citizen. Open Map → Route to shelter. The selected green line must avoid the orange R105 obstruction and the red flood reports.
2. Add a photo report at **27.7206, 85.327**. The route must change to the southern outer corridor. Add another at **27.7128, 85.327** to block the remaining alternative; no green route should remain. Resolve those custom reports when finished.
3. Sign in as admin. Open Incidents → Arun's H208 request → Route to Arun. Confirm both endpoints and a connecting route appear, with **From Riverside response base** above the map.
4. Select Use my location. A simulator without a configured location must show a recovery message without relabelling the base as GPS. On an iPhone, permit location access and verify the real origin. Internet and road-provider coverage are required for device/manual directions.

Scenario corridors and travel times remain simulated, as disclosed in route/source details. Live OSRM routes are screened alternatives from the provider; WaySignal does not fabricate a real-road detour when none is returned. A green line denotes a selected candidate to an open recorded shelter, not verified flood-free terrain.

Automated regressions cover pending debris/flood/road-block reports, actual geometry changes, map-buffer clearance, shared admin/citizen behavior, reports arriving during provider work, all-blocked results, resolution/rejection, and request authorization. The native changes also require the macOS CI simulator build; interactive GPS behavior must be checked on the Mac/iPhone.
