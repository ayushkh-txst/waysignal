# Copy this into Figma Make

Design WaySignal, a native iPhone app and companion desktop responder workspace, using the attached WaySignal design brief and SVG reference boards. Working tagline: “Know the route. Share the signal.” Design a product prototype with connected interactions.

We are adapting the existing G-one application. Preserve access to ALL existing functionality: citizen overview, alerts, live map, weather/flood context, facility lookup, hazard reports with optional photos, AI/voice guidance, route analysis, assistance requests, responder map, incident queue, dispatch, assignment, progress/history and operational reports. Keep the native core focused; put secondary functions in clearly labeled additional screens. Preserve the existing responder tools and add Community Review. Do not put an assistant panel in the responder dashboard.

Categories: Navigation × Social Media × Productivity. Make them depend on one another: a location-based community observation enters a responder review task; reviewed active hazards change route assessment; assistance assignment updates the citizen's recorded status. Finishing assistance must never automatically clear a road report.

Create four native tabs: Map, Community, Help and Guide. Design 390 × 844 iPhone frames, with layouts that work at 375 × 812 and enlarged text. Use SwiftUI-friendly lists, sheets, forms, cards and native map overlays. Use 20 px side padding, 8-point spacing, minimum 44 × 44 controls, visible labels and semantic status icons.

Visual direction: calm, precise and outdoors-readable. Background #F5F7FB, white surfaces, navy #14253D primary text, #56657A secondary text, #155EEF primary actions, #B42318 reviewed active hazards, #9A5700 unreviewed reports, #0F766E resolved state and #667085 unknown states. Use SF Pro or a close fallback. Keep maps prominent, cards simple and actions easy to reach. Unknown is neutral, never green. Distinguish unreviewed, reviewed active, resolved, rejected, expired and unavailable with words and icons as well as color.

Build these core frames first:
1. Sign-in and server connection, with a concise prototype notice.
2. Map overview with report markers, current/manual starting point, destination entry and “Assess driving routes.”
3. Manual coordinate sheet for start and destination.
4. Driving-route comparison with source/time, excluded candidates, nearby report findings and “no remaining candidate” state.
5. Community feed with report source, observation time, review status, coordinates and review note.
6. New observation sheet: hazard type, coordinates, optional photo and explicit submission.
7. Report receipt: awaiting review, record ID and return action.
8. Assistance form: type, people count, coordinates, note and explicit submission.
9. Assistance receipt/status: submitted, assigned, en route, resolved or cancelled; source timestamps and recorded responder.
10. Guide with three contextual actions: summarize reports, explain a route assessment, check a selected request. Show “Source summary” and tappable source cards.
11. Source details, account/settings and access to the full G-one web workspace.
12. Desktop Community Review: queue, selected report, map/photo evidence, public review note, version, confirm/reject, resolve/reopen and history.
13. Existing responder assistance queue and selected request with assignment/progress controls.

The first Swift implementation provides MCP source summaries, not native generative chat. Put a free-text Guide composer and native voice in a separate “Future” design section; preserve the inherited G-one web AI/voice features. Keep engineering terms such as MCP out of ordinary product controls.

Prototype this one memorable story with shared local fixture state: a citizen reports a blocked road; a responder reviews it; one route candidate becomes excluded; Guide explains the change with that report as a source; the citizen requests assistance; a responder assigns it; the citizen sees the recorded assignment. Use clearly fictional demo records R-104 and H-208. Show “Demo data” on every frame containing synthetic records. Figma interactions are a simulation, not a connection to the live backend. Do not promise route safety, shelter availability or responder arrival time. Label travel estimates “driving.”

Include loading, empty, location-denied/manual-entry, offline, stale-data, save failure, version conflict, photo failure, no route and all-candidates-excluded states. Only show success after the simulated successful response. Never show a blank feed as proof that conditions are safe.

Create Figma pages: 00 Read me, 01 Foundations, 02 Components, 03 iPhone Core, 04 iPhone States, 05 Responder, 06 Prototype, 07 Handoff, 08 Future. Use Auto Layout, semantic variables, component variants and human-readable layer names. Wire the core demo before adding optional polish. Annotate state transitions and SwiftUI component mappings outside the product frames.

Finally, create six storyboard compositions for export into the required Adobe Express presentation: problem, product, category dependency, connected demo, engineering/reuse, and built-versus-future progress. Focus on the same report-to-response story. Do not invent impact numbers or claim a Figma design is a shipped feature.
