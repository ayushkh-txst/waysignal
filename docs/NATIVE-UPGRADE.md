# WaySignal native app update

The walking-person W uses a white background, navy strokes and gold signal arcs. The same artwork is packaged as the home-screen app icon and the in-app mark. The welcome screen uses the original G-one landscape illustration, exported from its existing SVG source.

## Apply on the Mac

Unzip `WaySignal-App-Update.zip`, then run:

```bash
bash "$HOME/Downloads/WaySignal-App-Update/apply-update.sh"
```

The installer targets `~/Downloads/waysignal`, saves a dated backup of affected files in Downloads, applies the native/API changes, and runs the signed simulator build. It preserves local environment files, databases, credentials and unrelated source files. It restarts only a uvicorn process verified as belonging to this project's backend. A different process on port 8000 stops the installer with a message.

If your project is elsewhere, pass its path as the first argument. To apply files without launching, pass `--apply-only` as the second argument. The original project folder remains your working project; the update folder is an installer.

After the first application, rebuild at any time with:

```bash
cd "$HOME/Downloads/waysignal"
bash scripts/run-ios-demo.sh
```

Build output: `build/WaySignal-build.log`. Server output: `build/WaySignal-backend.log`. If Xcode reports an error, share the error text printed by the script. Do not delete the existing project or database.

## Native screens

| Workspace | Included behavior |
|---|---|
| Welcome | Walking W logo, G-one landscape, role introduction, email/password sign-in, server connection, reduced-motion-aware entrance |
| Citizen Home | Community/request counts, forecast and river context, mapped destinations, quick links |
| Citizen Map | Main map canvas, standard/hybrid layers, report detail markers, facility markers, recenter, MapKit place search outside demo, manual start/destination, route assessment and comparison |
| Community | All/nearby/route/mine views, open/closed filter, text observations, optional photo, review history and authorized photo access |
| Help | Assistance form, recorded assignment/en-route/completion timeline, cancellation of unassigned requests, 10-second refresh while visible |
| Guide | Typed conversation, suggested questions, microphone transcription, optional spoken replies, linked source records, context-aware MCP retrieval |
| Responder Overview | Counts from actual incident/report records, requests awaiting assignment, forecast context |
| Responder Incidents | Active/mine/all filters, search, location and request details, assign-to-me, en-route and completion updates |
| Responder Map | Active requests and community observations on a geographic map |
| Responder Review | Review note, confirm/reject, resolve active hazards, optimistic conflict handling, photo/history detail |
| Responder Reports | Last-seven-day aggregates, status/type bars, authenticated CSV export and share sheet |

A welcome-screen selection explains the workspaces; it does not grant privileges. The server-authenticated account role selects the actual workspace. Sign out through Account to change roles.

Demo citizen: `citizen@example.com` / `CitizenDemo2026!`

Demo responder: `worker@example.com` / `WorkerDemo2026!`

## Assistant configuration

Guide makes authenticated MCP calls to these six tools:

- `assess_route`
- `list_route_reports`
- `get_assistance_status`
- `get_local_conditions`
- `find_nearby_facilities`
- `list_assistance_requests`

Both REST and MCP use the existing authorization and domain services. Citizens cannot inspect another citizen's private assistance records. Guide reads data; it never dispatches people or submits forms on behalf of the user.

Without a generative provider, conversation returns clearly labeled source summaries. For generated answers, configure `OPENAI_API_KEY` and `GUIDE_AI_MODEL` in the backend's local `.env` using a model available to your account, then restart the backend. Keys stay on the server. A provider failure falls back to a labeled source summary, retaining source links. The provider path has contract/failure tests; a paid live model request has not been exercised in this workspace.

Voice input requires microphone and speech permission on the Mac/simulator or device. Transcription is reviewed in the composer before the user sends it. Text input remains available when speech is unavailable.

## Demo sequence to record

1. Sign in as citizen. Show the new logo, Home, forecast and Map.
2. Assess the default demo journey. Open route comparison and the R104 observation.
3. Sign out; sign in as responder. In Review, confirm R104 as active with a note.
4. Return to citizen. Assess the same route again. The direct candidate is excluded and the alternative is selected.
5. Ask Guide why the route changed and open its linked record.
6. Submit an assistance request with an explicit demo note.
7. As responder, assign the request, mark en route, then completed. Show the matching citizen timeline.
8. Capture the Reports view and a screenshot of the home-screen icon.

Keep the synthetic-data banner visible. Demo routing uses schematic fixtures, not navigable live directions. Mapped facilities do not imply verified capacity or open shelter status.

## Verification and remaining scope

The backend regression suite passed 96 tests before the final request-body guard was added; the 16 WaySignal integration tests were rerun after that guard. The suite checks native-facing endpoints, review-to-route changes, real MCP client/server calls, photo/assistance ownership, observation idempotency and provider failure behavior. Swift sources, plist files and asset manifests were parsed. Installer backup/copy behavior is verified on a disposable copy.

The earlier starter app compiled and ran on the user's Mac. This expanded native UI has not yet been compiled or visually exercised in Xcode here because this environment has no Apple SDK. The installer performs that required build on the Mac and surfaces the first errors. Simulator microphone, MapKit rendering, keyboard layout and new-screen interactions still require that run.

All inherited G-one source remains present. Advanced inherited web dispatch tools are accessible from Account's web-workspace link. This update does not claim official emergency integration, push notifications, offline synchronization, verified shelter capacity, navigation-grade turn-by-turn directions, automatic emergency dispatch, or a native port of every legacy administrative panel. The Figma brief contains future ideas; only implemented and demonstrated behavior belongs in the submitted feature list.
