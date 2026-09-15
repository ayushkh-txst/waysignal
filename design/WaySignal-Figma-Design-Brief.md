# WaySignal — complete Figma design brief

Prepared for Ayush Khadka • September 14, 2026

Deliverable: a design specification and prompts for an editable Figma Design file or a visual prototype in Figma Make. The accompanying SVGs are static vector reference boards; they do not contain native Figma Auto Layout, component variants, or wired interactions. All incident, responder, route, distance, and timing examples are synthetic demonstration data.

Latest scope: preserve **all existing G-one functionality** in the new repository and design. Keep its overview, alerts, live maps, environmental context, voice/guidance, reporting, incident queue, dispatch, assignment, history, and operational reports accessible. The four native tabs are the initial mobile organization, not authorization to delete existing modules. Use additional labeled screens for the existing secondary features. The source baseline contains 131 files at commit `9e9ebb009ffcb9ee79f3e80da6bc8401df08f2aa`.

## Copy-ready master prompt

Design **WaySignal**, a polished native iPhone application with a companion desktop responder dashboard. It combines **Navigation × Social Media × Productivity**: route-specific community reports enter a responder review queue, reviewed road conditions affect route assessment, and responder progress updates reach the traveler. Use the specifications below as the complete design brief. Produce app screens and connected user flows rather than a marketing website.

The mobile app is intended for SwiftUI and MapKit. The responder dashboard will adapt an existing React application. Keep layouts achievable using native controls, lists, sheets, forms, tabs, and map overlays. Use a calm light theme, a prominent map, dark navy typography, blue navigation actions, dark red reviewed closures, amber unreviewed reports, and neutral unknown states. Make the interface readable outdoors and usable one-handed. Use large labeled actions and consistent line icons. Avoid decorative analytics, invented accuracy scores, and dense dashboard cards on the phone.

Create four mobile tabs: **Map, Community, Help, Guide**. The app opens on Map. Report creation is an action from Map and Community. Profile/settings opens from the top-right control. The responder dashboard has **Review queue, Assistance, Map, History** and no assistant panel.

Design one coherent demonstration around report `R-104` and help request `H-208`: a traveler reports a blockage on Riverside Road in a clearly labeled demo area; a responder reviews it; the route assessment changes; the citizen asks Guide for an explanation grounded in report R-104; the citizen requests assistance and sees an assigned status. Road condition and assistance state are separate. Completing a help request must not mark a road clear.

Every design frame that contains synthetic data must visibly say **Demo data**. The help flow must make clear that the demo does not contact emergency services. Never label a route “guaranteed safe,” turn unknown information green, or invent an actual responder arrival estimate. Show unreviewed, reviewed active, resolved, expired, and unavailable states distinctly. Preserve source timestamps in report details and explanations.

Build a reusable component system with Auto Layout, semantic color variables, typography styles, named variants, responsive behavior, and annotated interactions. Build the P0 frames first, then optional frames and edge cases. If generating an interactive prototype, use local shared fixture state so report review updates the route feed and task assignment updates the citizen's status. These interactions are a simulation; do not imply that the Figma prototype contacts a live backend.

## 1. Figma file organization

File title: **WaySignal / Product Design / v1**.

| Page | Contents |
| --- | --- |
| `00 · Read me` | Product statement, categories, legend, build priorities, data assumptions |
| `01 · Foundations` | Color variables, type styles, spacing, icons, elevation, motion |
| `02 · Components` | Buttons, fields, pills, cards, sheets, tabs, maps, timelines, tables |
| `03 · iPhone · Core` | P0 phone screens and the successful end-to-end flow |
| `04 · iPhone · States` | Errors, permission denial, no routes, empty feeds, loading, stale data |
| `05 · Responder` | Review queue, incident detail, assistance workflow, history |
| `06 · Prototype` | Citizen flow and responder flow start points with annotated handoff |
| `07 · Handoff` | Component/state mappings, service dependencies, asset export notes |

Frame naming: `M01 / Map / Demo default`, `M04 / Routes / Reviewed closure`, `D02 / Review / Report selected`. Use human-readable layer names and component instances. Keep design notes outside product frames.

Use Figma Auto Layout for variable-height cards, wrapped chips, forms, and lists; use fill-container widths for content and hug-content sizing for labels. Map overlays are the main place for deliberate absolute positioning. [Figma Auto Layout documentation](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)

## 2. Brand and foundations

Working name: **WaySignal**. Tagline: **Know the route. Share the signal.**

Logo direction: a simple route segment connecting two circular points, with one small signal arc. The app icon is a blue rounded square with a white route mark. Design it as a vector and keep the name in live text outside the mark. No national seal, medical cross, police badge, or implication of government affiliation.

Primary mobile canvas: **390 × 844** logical design units. Validate at 375 × 812 and with enlarged text. Use a 4-column reference grid, 20-unit side margins, and 12-unit gutters. Start with reference safe-area insets of approximately 54 top and 34 bottom, then use the actual native safe areas in implementation. Fixed action bars must sit above the home indicator and keyboard.

Desktop canvas: **1440 × 1000**, with a 220-unit sidebar, 64-unit header, 24-unit main padding, and 20-unit panel gaps. Validate at 1280 wide. On narrower layouts, the details pane becomes an overlay sheet.

| Semantic variable | Value | Use |
| --- | --- | --- |
| `color/background` | `#F5F7FB` | App background |
| `color/surface` | `#FFFFFF` | Cards, sheets, input surfaces |
| `color/text/primary` | `#14253D` | Primary text |
| `color/text/secondary` | `#56657A` | Supporting text |
| `color/border` | `#DCE3ED` | Separators and fields |
| `color/action/primary` | `#155EEF` | Navigation and primary actions |
| `color/action/pressed` | `#1249BE` | Pressed primary action |
| `color/action/tint` | `#EAF0FF` | Selected controls and information surfaces |
| `color/closure` | `#B42318` | Reviewed active closure, important destructive action |
| `color/closure/tint` | `#FEECEB` | Closure callouts |
| `color/pending` | `#9A5700` | Unreviewed report text and icons |
| `color/pending/tint` | `#FFF3D6` | Unreviewed callouts |
| `color/resolved` | `#0F766E` | Completed/resolved status only |
| `color/resolved/tint` | `#DFF4EE` | Completed/resolved badges |
| `color/unknown` | `#667085` | Unavailable or unknown data |
| `color/unknown/tint` | `#EEF1F5` | Unknown data surfaces |

Use white text on the primary and closure buttons. Verify contrast in the finished file; status colors always accompany a text label and an icon or pattern. Do not use a green map region to imply verified safety.

Typography: SF Pro when available for iPhone; use Inter as the design fallback and for the web dashboard. Use tabular figures for times and distances. Native implementation should map to Dynamic Type text styles.

| Text style | Reference size / line height | Weight |
| --- | --- | --- |
| Large title | 30 / 36 | Bold |
| Screen title | 24 / 30 | Semibold |
| Section title | 20 / 26 | Semibold |
| Body | 17 / 24 | Regular |
| Button / emphasized body | 17 / 22 | Semibold |
| Supporting text | 15 / 21 | Regular |
| Metadata | 13 / 18 | Medium |
| Desktop table text | 14 / 20 | Regular |

Spacing scale: **4, 8, 12, 16, 20, 24, 32**. Standard button height: **52**; assistance primary action: **56**. Minimum interactive target: **44 × 44**. Card padding: 16; card radius: 18; field radius: 12; sheet top radius: 28. Use a subtle low-opacity shadow only on floating map controls and sheets.

Use consistent SF Symbols in the native app and a matching outlined icon family on the web: map, location arrow, speech bubbles, warning triangle, helping hand, sparkles, person, clock, check, plus, and chevron. Use 22–24-unit primary icons. Labels must explain actions without relying on icon interpretation.

Accessibility requirements include readable contrast, text resizing, visible focus, labeled controls, map alternatives as lists, non-color status cues, and reduced-motion behavior. [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility)

## 3. Shared components and variants

| Component | Properties / variants |
| --- | --- |
| `Button` | Primary, secondary, text, important; default, pressed, disabled, loading; label and optional icon |
| `TextField` | Empty, filled, focused, invalid, disabled; label, hint, error, optional trailing action |
| `TabBar` | Four named tabs; one selected; optional Help badge for an active request |
| `DataBadge` | Demo data, updated time, cached, unavailable; data mode kept separate from incident state |
| `ReportStatus` | Unreviewed, reviewed active, resolved, expired, rejected |
| `RequestStatus` | Requested, assigned, in progress, completed, canceled |
| `RouteCard` | Default, selected, affected, unavailable; distance, duration, source time, report count, explanation |
| `ReportCard` | Feed, compact, expanded; type, title, location, status, observed time, report ID |
| `MapPin` | Current location, unreviewed hazard, reviewed closure, resolved report, destination; selected/unselected |
| `BottomSheet` | Compact, half-height, expanded; labeled header and explicit close/minimize control |
| `SourceRow` | Report ID, observation time, review state, tap to open source |
| `TimelineRow` | Current, completed, upcoming; event time and actor where available |
| `EmptyState` | Title, concise explanation, one useful action |
| `ConnectionBanner` | Refreshing, cached, offline, server unavailable; timestamp and retry action |
| `QueueRow` | Default, selected; only one selected row; consistent selected outline/background |
| `ReviewAction` | Mark reviewed active, reject, resolve, add note; clear role restrictions |

Use separate components for report review state and assistance state. A reusable visual style does not make their semantics interchangeable. The Guide source cards display application evidence; technical names such as MCP, FastAPI, PostgreSQL, or tool JSON stay in handoff annotations.

## 4. Mobile navigation

Four tabs: **Map / Community / Help / Guide**. Keep the tab order and labels fixed. A profile icon opens Account. Context actions can open a screen in another tab with the current route or report already selected. Report creation opens a sheet from Map or Community. It is not a fifth navigation tab.

## 5. Mobile frame specifications

### M00 · Welcome and sign-in · P1

Short welcome: “Know the route. Share the signal.” Subtext: “See community reports, understand route conditions, and keep track of assistance.” Primary button “Sign in”; secondary “Explore demo.” Use the existing supported authentication method. Demo access is a clearly isolated prototype experience. Do not invent unsupported Apple/Google login buttons or a self-service responder role switch. When location is first needed, request native permission with a clear purpose; manual entry remains available.

### M01 · Map home · P0

Map fills most of the screen. Top area: location label “Demo area,” small “Demo data” badge, profile control. Search field: “Where do you need to go?” Show current location and meaningful hazard symbols. Place recenter and map legend controls together on the right; report button remains a large labeled control.

Bottom sheet: title “Know what is ahead,” supporting copy “See reports that may affect your journey.” Show one featured unreviewed report card for R-104, with title “Road blockage reported,” location “Riverside Road · demo location,” and timestamp. Primary action “Choose destination”; secondary “Report a hazard.” The Help tab remains directly available.

The map reference artwork is schematic and labeled as a demo. The implemented app must render real provider geometry and preserve attribution. Do not create decorative flood polygons with unsubstantiated severity levels.

### M02 · Location and destination · P0 overlay

Fields for starting location and destination. “Use current location,” “Drop pin,” and “Enter coordinates” are available. Coordinate entry accepts latitude and longitude with explicit labels, validation, and map preview. If location access is denied, keep manual entry functional. Show a selected destination name and confirm action “Use this destination.” For the demo, use “Community Center · demo location”; do not call it an official shelter.

### M03 · Route options · P0

Top back control and destination. Map shows candidate route lines. Selected route is solid blue; an affected segment is dark red with a closure symbol; unreviewed conditions use amber markers. Use text descriptions alongside the map.

Bottom sheet has two fixture cards: Route A, “1.2 km · 15 min,” “Reviewed closure on this route”; Route B, “1.8 km · 22 min,” “Avoids the reviewed closure.” These distances and times are synthetic and belong to the Demo data state. A route without a current known intersection must still show “Conditions may change.” Route B may be selected only when an actual candidate exists in the implementation.

Primary action “View route”; secondary “Why this route?” which opens Guide with route context. Display relevant report count and last assessment time. Never use “Safest route” or a made-up percentage risk score.

### M04 · Route detail · P0 state

Expanded route view with destination, distance/duration, last update, affected reports, and route conditions. Keep “Report a hazard,” “View reports,” and “Request assistance” accessible. A changing report produces a compact “Route information updated” banner and a “Review changes” action. Full turn-by-turn navigation is a later feature unless the existing implementation is verified.

### M05 · Community feed · P0

Title “Community.” Filter chips “Along my route,” “Nearby,” and “My reports.” Default to Along my route when a route is selected; otherwise Nearby with a clear area label. A large “Report a hazard” action appears near the top. Cards contain hazard type, short observation, location, status, observation time, and report ID. An affected-route badge links back to route detail.

The core social interaction is publishing and following relevant community updates. Use an “Updates” link to the report timeline; avoid building likes, followers, public contact directories, or engagement rankings tonight. Other citizens' private assistance locations and contact details never appear in this feed.

### M06 · Report detail · P0

Header “Report R-104.” Status badge, title, location, map snippet, reported time, latest review time, and chronological update rows. Include the report's route relevance and source identity at a privacy-appropriate level, such as “Community report” or “Responder review.” Primary action “View affected route”; secondary “Ask Guide.” Reporter edit/withdraw actions appear only if supported and authorized. Responders review reports in the desktop workflow.

### M07 · Create report · P0

Title “Report a hazard.” Short explanation “Share what you can observe from your current position.” Select hazard type using a single-selection control: Road blockage, Flooding, Other. There must be one visibly selected option at a time. Location section offers current position, map pin, or manual coordinates. Notes field: “What did you observe?” Observation time defaults to now and can be corrected. Photo attachment is P1 and must not look functional in a P0-only build.

Primary action “Submit report.” During submission disable repeated taps and show progress. Success page says “Report submitted — awaiting review” with R-104 and actions “View report” / “Back to map.” A failed request says “Report not sent” and preserves entered values. Never show a green success state before confirmation from the backend in the real app.

### M08 · Help home and request form · P0

Help home displays the current active request, if one exists, with “View status.” The new request form uses the title “Request assistance.” Show location preview with “Change location,” need options “Cannot continue,” “Need transport,” and “Other,” a short description, and party size if supported. Avoid collecting unnecessary personal information.

Use a large red “Send assistance request” button. Immediately above it show the location being shared and the message “Your request and location will be shared with authorized responders.” In demo mode also display “Demo only — no emergency services will be contacted.” This action submits a request, not a guarantee of dispatch or rescue.

Do not require chat, a tutorial, or a paywall to reach this form. Do not publish a region-specific emergency number unless verified for the configured deployment.

### M09 · Assistance status · P0

Header “Request H-208.” Large current status, small location row, last update, and a timeline: Requested, Assigned, In progress, Completed. Only events that happened show timestamps. An assigned responder row may show “Team 2 · demo responder.” Arrival time remains “Not provided” unless sourced. Support canceled state and a reviewable cancel action where allowed.

When connection fails, retain the last known status with its timestamp and show “Could not refresh.” A pending local submission is visibly different from a server-confirmed request. A completed request does not display any claim that nearby hazards are resolved.

### M10 · Guide · P0

Header “Guide.” Supporting copy “Answers based on your route and reports.” Suggested prompts: “Why is this route flagged?”, “Show reports along my route,” “What is my request status?” The composer sits above the tab bar/keyboard and has a labeled send control.

Responses combine concise explanation with source cards, rather than a wall of chat text. Fixture response: “Route A intersects the reviewed blockage in report R-104. Route B avoids that reported segment. This does not establish that every part of Route B is safe.” Source card opens Report R-104 and shows review/observation time. Status answers link to H-208. Loading copy: “Checking route information…” Error copy: “Guide is unavailable. You can still use the map and request assistance.”

Do not expose MCP names, tool-call JSON, chain of thought, model logs, or provider settings in the product. If a response needs user action, use a concrete card linking to the relevant form, not an automatic submission or fabricated completion.

### M11 · Account and preferences · P1

Signed-in identity, location preference, data mode, sign out, and accessibility/appearance choices only where supported. The authenticated role is read-only. A demo role switch belongs to clearly labeled prototype controls outside the production experience.

## 6. Responder dashboard specifications

### D01 · Review queue · P0

Desktop layout with 220-wide sidebar, main queue, and selected-report details. Sidebar: Review queue, Assistance, Map, History. Header includes “Responder workspace,” data freshness, signed-in role, and Demo data badge. No AI assistant panel.

Queue filters: Unreviewed, Reviewed active, Resolved. Each row shows report ID, hazard type, location, observed time, and status. Select exactly one row at a time. Counts, if displayed, must match the local fixture list or actual response; avoid decorative KPI cards.

### D02 · Report review detail · P0

Selected report R-104 shows a larger map, source observation, timestamps, and history. Show “Mark reviewed active” and “Reject report” as distinct actions. A review sheet includes a short note and explicit submit button. Only reviewed active reports offer “Mark resolved.” The selected incident location and details must always correspond to the selected queue row.

After a successful review, update that row's status, timeline, and the relevant route context. The incident detail remains visible; do not unexpectedly switch to another row. If the request fails, preserve the selection and draft review note.

### D03 · Assistance queue and assignment · P0

Queue columns: Request, Need, Location, Received, Status, Assigned to. A detail pane contains the private location, request note, related report link if present, and timeline. Assignment is a single-selection responder control with “Assign request.” Then expose valid next transitions, such as “Start work” and “Complete request.” Keep route/hazard resolution as a separate report operation.

For the prototype, H-208 progresses from Requested to Assigned to Team 2. The citizen status screen must show the same state when the demo is wired. Request ownership and responder permissions are implementation requirements, not controls the viewer can toggle in the app.

### D04 · Map and history · P1

Operational map with report/assistance layer toggles and a selected-item panel. History is a plain table of reviewed reports and request events with actor and time. Distinguish private assistance data from public report data. Keep these as extensions of the existing modules rather than a new analytics product.

## 7. Required state variants

| Situation | Visible behavior |
| --- | --- |
| Data loading | Stable skeleton layout or spinner, no invented current values |
| Empty report feed | “No reports found for this area” with timestamp and report action; no safety claim |
| No reviewed information | “Current conditions are unknown” with neutral styling |
| No usable route candidate | “No route is available from the current data” and change-destination / help actions |
| Location permission denied | Manual location entry and optional device-settings link |
| Invalid coordinates | Inline field-specific error; preserve valid input |
| Cached information | Last-updated label and visible cached state |
| Server unavailable | Retry banner; forms preserved; no fabricated submission success |
| Expired sign-in | Explain that sign-in is needed; preserve the task if possible |
| Guide unavailable | Map/report/help remain available |
| Submission pending | Disabled submit button, progress, no duplicate creation |
| Submission failed | “Not sent,” retry, retained form data |
| Report expired | Expired badge, evidence retained, reassessment requested |
| Request canceled | Canceled state and actual event time |
| Large text | Labels wrap, cards grow, controls remain reachable |

## 8. Connected prototype flows

Citizen flow: Map → destination selection → route options → Community along route → report form → submitted/unreviewed report → route detail after review → Guide explanation → assistance form → confirmed request status → assigned status.

Responder flow: Review queue → R-104 detail → review dialog → reviewed active → Assistance → H-208 detail → assign Team 2 → assigned state.

In Figma Design, use variables where practical or explicitly paired before/after frames with a reviewer-controlled demo checkpoint. Do not imply that separately opened prototype windows synchronize live. In Figma Make, shared local fixture state can model the loop. Preserve the “Demo data” label throughout.

Prototype transitions: instant for urgent actions and state changes; approximately 180–220 ms for sheet navigation if motion is useful. No flashing warning animation, pulsing red background, or delayed access to assistance. Provide close/back actions and keep focus on the changed content.

## 9. Priority and generation order

**Pass 1:** foundations and components, M01 Map, M03 Routes, M05 Community, M07 Report, M08 Help request, M09 Status, M10 Guide, D01/D02 review, and D03 assignment.

**Pass 2:** destination/manual location overlay, report detail, route detail, permission and connection errors, no-route states, large-text checks, and connected prototype interactions.

**Pass 3:** welcome/account, attachments, responder map/history, optional dark appearance. Keep these visibly marked P1 until implemented.

If the design generator struggles with the full brief, generate the mobile P0 frames first, then apply the same foundations to responder frames in a second pass. The SVG references communicate composition; rebuild reusable components with Auto Layout and semantic variables in the native Figma file.

## 10. Handoff and acceptance

| Design module | Implementation owner / service boundary |
| --- | --- |
| Map / routes | Map view model and RouteAssessmentService |
| Community / reports | Report view models and ReportService |
| Help / request status | Assistance view models and AssistanceService |
| Guide / source cards | AssistantService using MCP-backed information |
| Responder review | Authorized report-review operations |
| Responder assignment | Authorized assistance operations |

Annotate component states, input validation, source fields, and error behavior. The UI should render typed state supplied by each feature service. Adding a hazard type should reuse the report/pin/card structure where appropriate, with a new type label and supported icon; do not encode route policy in the design layer.

The design is ready for implementation when: all P0 screens exist; one report and one assistance request keep consistent IDs and states throughout; the two category dependencies are visible; the selected queue row matches its detail pane; every primary action has an outcome or error state; manual location is available; source times and data modes are visible; the Guide has source links; and the large-text layouts remain usable.

The accompanying reference boards show eight principal iPhone compositions and two responder compositions. Additional screens, states, and prototype wiring are specified here. The boards contain schematic maps and synthetic data, not live geographical or emergency information.

## 11. Design for both awards

The supplied event screenshot emphasizes creative category integration, design, and execution for Product Awards; Best Product Storytelling requires the presentation in Adobe Express. Use Figma to develop the product and presentation assets, then assemble the final story in the provided Adobe Express template. Awards are a goal, not a guaranteed outcome.

The story follows one traveler and one responder. Lead with the problem: a map can show a road while community information says that road has changed. Then demonstrate the category dependency through the same report and assistance request used in the product. Show actual working behavior in the final video and clearly distinguish prototype animation from implementation.

| Story beat | Proposed headline | Visual evidence |
| --- | --- | --- |
| 1. Opening | When the road changes, your route should too. | One native map screen with a reported blockage |
| 2. User need | What changed? Who has reviewed it? Has anyone accepted my request? | Three short questions beside the citizen screen |
| 3. Category fusion | One report connects the journey and the response. | Report → review → route assessment, with separate assistance progress |
| 4. Product demonstration | Watch the information become action. | A focused 60–90-second recording of the implemented flow |
| 5. Responder view | Every request has a visible next step. | Selected incident, assignment, and citizen timeline |
| 6. Engineering | Shared rules. Traceable explanations. | Compact architecture plus evidence-linked Guide response; mention MCP and SRP/OCP here |
| 7. Delivery and next step | Built today on a credited foundation. | Honest reused/new/future feature inventory, repository and demo links |

Map these beats into the required template's existing structure; the suggested number and duration are editorial choices, not event rules. Use the same typography, colors, report IDs, and screenshots throughout. Avoid invented adoption, accuracy, or impact statistics. If describing the Nepal connection, use Ayush's real motivation without inventing personal experiences. Keep a recorded demo and reserve the final 90 minutes for the Adobe Express presentation and submission checks.
