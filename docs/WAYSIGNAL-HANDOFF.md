# Current native upgrade

The original handoff below documents the initial slice. See [NATIVE-UPGRADE.md](NATIVE-UPGRADE.md) for the expanded native screens, real voice/chat implementation and six MCP tools, and [README.md](../README.md) for current setup and verification. The earlier statements that native chat and responder screens are future work are superseded by that update. The full source is published at [ayushkh-txst/waysignal](https://github.com/ayushkh-txst/waysignal).

# WaySignal implementation handoff

Prepared September 14, 2026. Working name: WaySignal. Category fusion: Navigation × Social Media × Productivity.

## Implemented in this new snapshot

- Preserved all 131 files from G-one main at `9e9ebb009ffcb9ee79f3e80da6bc8401df08f2aa`. The imported snapshot has a separate local baseline commit; the upstream repository's historical commits were not imported.
- Added an iOS 17+ SwiftUI project with Map, Community, Help and Guide tabs; secure session storage; manual coordinates; optional location access; photo reports; driving-route assessments; assistance creation, cancellation, polling and source details.
- Added a responder Community Review page to the existing web application, including review notes, photos, history, resolve/reopen actions and version conflicts.
- Added shared route/report services, persisted review decisions and real authenticated MCP tools.
- Added startup scripts and a frontend dependency lockfile. Fixed one inherited test assertion that assumed a plain header object; the actual API client correctly supplies a `Headers` instance.

## What is preserved versus ported

All G-one source and features remain in `frontend/` and `backend/`. Only the four core citizen flows are ported to native Swift in this first slice. Existing environmental context, alerts, facility lookup, AI/voice guidance, extended route analysis, operational metrics and responder dispatch remain available in the full web application. Open that application through **Map → Your workspace → Open full web application**, or use the desktop browser. Browser authentication is separate.

The existing G-one web route analyzer retains its existing behavior. The new review-aware route assessment is used by the native app and the MCP adapter. Making every inherited web route view use the new assessment service is a later integration step.

## Figma work happening alongside development

Use `design/WaySignal-Figma-Design-Brief.md` and the two SVG reference boards. The SVGs contain editable vector artwork; they are static references without Auto Layout or wired Figma interactions. No native Figma document has been created by this implementation.

The complete design brief includes future frames. For the first code-aligned design pass, use four tabs, manual coordinate entry, report/photo submission, route findings, assistance status, source summaries and the responder review page. The native Guide currently offers three contextual source-summary actions. A free-text generative chat composer and native voice are future work; the inherited web AI/voice implementation remains preserved. Do not show those future native features as completed in the submission.

## Service boundaries

| Module | Responsibility | Extension point |
| --- | --- | --- |
| SwiftUI views | Render state and collect explicit user actions | Reusable native components |
| Swift stores | Manage each feature's loading, data and errors | `CommunityServing`, `RouteServing`, `AssistanceServing`, `GuideServing` |
| API client | Encode authenticated HTTP requests | Inject a different client/service |
| CommunityService | Read public report metadata and persist authorized review decisions | Add a review policy independently |
| RouteAssessmentService | Coordinate providers, reports and hazard policies | `RouteProvider`, `ReportSource`, `HazardPolicy` |
| REST handlers | Validate incoming requests and call services | Add a transport without duplicating rules |
| MCP server | Authenticate tool calls and invoke shared services | Register additional read tools |
| Guide host | Discover and call MCP tools, then summarize source records | Add a model host behind a separate interface later |

The service constructor accepts a list of hazard policies. A new policy can implement `evaluate(report, distance_m)` and be registered at composition without changing the route-assessment loop. This is the Open/Closed extension boundary. Each feature store and service owns one responsibility; there is no all-purpose agent handling application writes.

## APIs and MCP

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/mobile/community` | Public community records plus review status/version |
| `POST /api/v1/mobile/community/{id}/review` | Worker-only reviewed-active/rejected decision |
| `GET /api/v1/mobile/community/{id}/history` | Public review decisions without reviewer account IDs |
| `POST /api/v1/mobile/routes/assess` | Screen actual OSRM driving candidates |
| `POST /api/v1/mobile/guide` | Invoke real MCP tools and return source summaries |
| `/mcp/` | Authenticated Streamable HTTP MCP server; internal/loopback host |

Read-only MCP tools: `assess_route`, `list_route_reports`, `get_assistance_status`. The guide initializes an MCP client session, discovers tools, invokes the selected tool and reads its structured output. It is not a generative AI answer. Assistance tool access uses the same ownership check as REST. Tokens are forwarded internally to preserve the user's role and identity.

Configure `MCP_INTERNAL_URL` for the actual loopback port. The provided startup uses `http://127.0.0.1:8000/mcp/`. Public external MCP/OAuth discovery is outside this slice.

## Route evidence rules

The service measures distance to every route segment, not just its vertices. Active flood, blocked-road and debris reports exclude nearby candidates even while unreviewed or expired. Other unreviewed observations generate warnings; reviewed active observations exclude routes. Resolved/rejected reports do not exclude routes. Review evidence expires after 24 hours in this prototype. Reopening a resolved report invalidates its previous review.

Default proximity thresholds match the map buffers: 120 metres for flood reports and 60 metres for other reports, expanded by reported location accuracy up to 250 metres. This is a local point-distance approximation, not flood polygons, road-network closure propagation or official certification. OSRM returns a limited set of driving candidates and is not asked to reroute around every report. If every candidate is excluded, the service returns no selected route. Provider failures do not become hazard-free results.

Community observations are visible to signed-in citizens and responders. Photos retain G-one's access rule: reporter or worker only. Responder notes are public to signed-in users. Assistance records remain private to their owner and workers. Completing assistance never resolves a road report.

## Validation performed here

- Backend: **88 tests passed**, including all 80 inherited tests and 8 new workflow/MCP integration tests.
- Frontend: production TypeScript/Vite build passed; **9 hazard tests passed**.
- New tests exercise review authorization, optimistic version conflicts, rejection/reopen, stale evidence, segment screening, all-routes-excluded, provider failure, real MCP discovery/calls, private request ownership and the real MCP client used by Guide.
- Swift syntax and Xcode project/plist structure parse checks passed. These do not type-check Apple APIs.
- Native Swift compilation, device interaction, MapKit rendering, Keychain behavior and simulator screenshots require Xcode on a Mac. They have not been verified here.
- No external route provider availability or real responder response is guaranteed. Existing browser automation suites have not all been rerun.

## Five-minute Mac verification sequence

1. Run `bash scripts/start-backend.sh` from the repository root. Keep the terminal open.
2. In a second terminal run `bash scripts/start-web.sh`.
3. Open `ios/WaySignal.xcodeproj`. Choose the WaySignal scheme and an iPhone simulator. Press Run. No signing team is required for the simulator.
4. Sign in with the existing citizen demo account. The exact local demo credentials are in `backend/app/core/config.py`; real deployments should use configured passwords.
5. Open `http://localhost:5173` in a desktop browser and sign in with the worker demo account.
6. On the phone, enter start/destination coordinates for a familiar demo area. Assess routes, then submit a road report at a point on a returned candidate.
7. In the web responder sidebar open **Community Review**, refresh, add a review note, confirm the active hazard. Back on the phone, refresh/reassess and inspect the report finding. If OSRM offers no remaining candidate, show that honest state.
8. Submit a clearly labeled demo assistance request. Assign it from the inherited responder queue. Within the phone's 10-second refresh cycle, verify the recorded status. Check the same request through Guide.

To build from Terminal on the Mac:

```bash
xcodebuild -project ios/WaySignal.xcodeproj -scheme WaySignal \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ENTITLEMENTS_REQUIRED=YES build
```

If Xcode reports an error, send its first compiler error and file/line so it can be fixed directly. Debug builds allow local HTTP development; Release requires an HTTPS server. The provided backend binds to loopback for simulator use. A physical iPhone needs a reachable development server or an HTTPS deployment.

## Submission story for both awards

Use Figma to design screens and Adobe Express to assemble the required presentation template.

1. **Problem:** a map, a community report and a response queue often describe different parts of the same situation.
2. **Product:** WaySignal makes an observation change the next journey and connects help requests to recorded responder progress.
3. **Fusion:** Navigation needs reviewed community evidence; that evidence gets an actionable location and responder task through the route workflow.
4. **Demo:** report → review → changed route assessment → assistance assignment → source-linked explanation.
5. **Engineering:** preserved G-one foundation, native SwiftUI, one set of service rules behind REST and MCP, explicit extension boundaries.
6. **Honest progress:** identify inherited G-one work, additions made during this hackathon, prototype limitations and future work separately. Use screenshots from the running build when available; label Figma simulations as design prototypes.

Use only demonstrated behavior in the submission. Do not claim official agency integration, safe-route certification, automatic emergency dispatch or measured lives saved. The public repository is [ayushkh-txst/waysignal](https://github.com/ayushkh-txst/waysignal). Native Guide now supports optional generated answers; its server-side model configuration and verification limits are documented in the current native upgrade guide.
