"""Regenerate the WaySignal system design SVG.

    python docs/diagrams/generate_waysignal_system_design.py

Describes the implemented system as of commit e2d58c6, not the pre-build proposal
in design/WaySignal-System-Architecture.md.
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).with_name("waysignal-system-design.svg")
W, H = 1600, 1640
BG, PANEL, CARD, EDGE = "#0f1416", "#161d20", "#1f282b", "#34424a"
WHITE, MUTED, DIM = "#f3f1ea", "#aebcc0", "#7d8d92"
GOLD, BLUE, GREEN, RED = "#e0b95c", "#86c6e6", "#8dd4b0", "#ea8f7c"

parts: list[str] = []


def add(s: str) -> None:
    parts.append(s)


def rect(x, y, w, h, fill=CARD, stroke=EDGE, r=14, dashed=False, sw=1.5):
    dash = ' stroke-dasharray="7 6"' if dashed else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>')


def text(x, y, s, size=17, color=WHITE, weight=400, anchor="start", mono=False):
    fam = ' font-family="Menlo, Consolas, \'DejaVu Sans Mono\', monospace"' if mono else ""
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}" xml:space="preserve" style="white-space:pre"{fam}>{escape(s)}</text>')


def lines(x, y, rows, size=15, color=MUTED, step=22, mono=False):
    for i, row in enumerate(rows):
        text(x, y + i * step, row, size, color, mono=mono)


def title(x, y, label, sub=None, color=GOLD):
    text(x, y, label, 19, WHITE, 700)
    if sub:
        text(x, y + 22, sub, 13, color, 600)


def band(y, label):
    text(60, y, label.upper(), 13, DIM, 700)
    add(f'<line x1="60" y1="{y + 8}" x2="{W - 60}" y2="{y + 8}" stroke="{EDGE}" stroke-width="1"/>')


def arrow(d, color=GOLD, dashed=False, both=False, marker="gold"):
    dash = ' stroke-dasharray="7 6"' if dashed else ""
    start = f' marker-start="url(#{marker})"' if both else ""
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" marker-end="url(#{marker})"{start}{dash}/>')


def label(x, y, s, color=GOLD, anchor="middle", size=13):
    pad = 6
    width = len(s) * size * 0.56 + pad * 2
    left = x - width / 2 if anchor == "middle" else x - pad
    add(f'<rect x="{left:.0f}" y="{y - size - 2}" width="{width:.0f}" height="{size + 9}" rx="5" fill="{BG}"/>')
    text(x, y, s, size, color, 600, anchor)


add(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">WaySignal system design</title>
<desc id="d">Citizen and responder SwiftUI apps and the G-one React web workspace call one FastAPI deployment over HTTPS with JWT bearer tokens. The deployment serves REST routers, the built web app, and a Streamable HTTP MCP server mounted at /mcp that only accepts localhost hosts. Nav AI runs inside the same process and calls /mcp over loopback with the caller's own token, so REST and MCP use the same CommunityService, RouteAssessmentService and MapStateService and the same authorization. Route assessment screens up to eight provider candidates against community reports through a HazardPolicy. Data lives in PostgreSQL on Render, or SQLite for the isolated demo. External providers are OSRM, Open-Meteo, Overpass, ArcGIS and an optional OpenAI Responses API. A multi-stage Dockerfile deploys to Render; GitHub Actions builds the iOS app on macOS.</desc>
<defs>
<marker id="gold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="{GOLD}" stroke-width="1.6"/></marker>
<marker id="blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="{BLUE}" stroke-width="1.6"/></marker>
<marker id="green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9" fill="none" stroke="{GREEN}" stroke-width="1.6"/></marker>
</defs>
<rect width="{W}" height="{H}" rx="24" fill="{BG}"/>
<g font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">''')

# ---------------------------------------------------------------- header
text(60, 70, "WaySignal — system design", 34, WHITE, 700)
text(60, 102, "Implemented architecture at commit e2d58c6 · one FastAPI deployment · REST and MCP share one service layer", 16, MUTED)

# ---------------------------------------------------------------- clients
band(150, "Clients")
cards = [
    (60, "Citizen iPhone app", "SwiftUI · iOS 17+", [
        "MapKit map, route comparison, shelters",
        "Community reports with photo + map pin",
        "Help requests and status timeline",
        "Nav AI chat · Speech in / AVSpeech out",
        "Vision OCR on-device for screenshots",
        "Polls /mobile/map-state every 8 s",
    ]),
    (565, "Responder iPhone app", "same binary · role=worker from JWT", [
        "Overview counts → filtered request lists",
        "Review queue: confirm / reject reports",
        "Directions from device, pin or base",
        "Shelter confirm / close (expiring)",
        "Reports with CSV export",
        "Session token in Keychain (opt-in)",
    ]),
    (1070, "Responder web workspace", "React · Vite · Leaflet (G-one)", [
        "Operations map and incident queue",
        "Dispatch review, notifications",
        "Community review, demo exercise",
        "Operational reports + CSV export",
        "OSM tiles loaded in the browser",
        "Served from the API's own origin",
    ]),
]
for x, name, sub, rows in cards:
    rect(x, 172, 470, 218)
    title(x + 22, 206, name, sub)
    lines(x + 22, 256, rows)

# client -> backend arrows
for cx in (500, 800, 1100):
    arrow(f"M{cx} 390 V508")
label(800, 446, "HTTPS  ·  REST /api/v1  ·  Authorization: Bearer <JWT HS256, 15 min>  ·  JSON")

# ---------------------------------------------------------------- backend
band(470, "Backend  —  one process: uvicorn app.main:app")
BX, BY, BW, BH = 60, 490, 1480, 660
rect(BX, BY, BW, BH, fill=PANEL, stroke="#48606b", r=20, sw=2)

# edge strip
rect(90, 512, 1420, 62, fill="#1a2327")
text(112, 540, "Edge", 16, GOLD, 700)
text(168, 540, "CORS allow-list  ·  JWT verify (signed_reporter: sub, role ∈ {citizen, worker}, exp)  ·  bounded request bodies (4 MB for Nav AI)", 14, WHITE)
text(168, 562, "/health  ·  /docs off in production  ·  SPA shell + static assets mounted at /  ·  /mcp mounted behind AuthenticatedMCP", 14, MUTED)

# column 1: routers
rect(90, 604, 440, 520)
title(112, 638, "REST routers", "thin transport adapters")
text(112, 690, "WaySignal  /mobile/*", 15, GREEN, 700)
lines(112, 714, [
    "GET  map-state · community",
    "POST community · community/{id}/review",
    "GET  community/{id}/history",
    "POST routes/assess · routes/shelter",
    "POST shelters · shelters/{id}/close",
    "POST incidents/{id}/route",
    "POST assistant · guide",
    "GET  scenario · POST scenario/reset",
], 13, WHITE, 21, mono=True)
text(112, 900, "Inherited G-one", 15, GOLD, 700)
lines(112, 924, [
    "/auth/login     /hazards     /emergencies",
    "/routing        /safety      /citizen-map",
    "/admin/dispatch /admin/reports(+/export)",
], 13, WHITE, 21, mono=True)
lines(112, 1006, [
    "Role checks live in the services, so a",
    "handler cannot forget them — and the MCP",
    "path cannot skip them.",
], 14, MUTED, 21)

# column 2: Nav AI host + MCP server
rect(560, 604, 460, 270)
title(582, 638, "Nav AI host", "assistant.py · guide.py", BLUE)
lines(582, 688, [
    "1  Validate + re-encode image (strips metadata)",
    "2  \"How do I…\" → canned app help, no tools",
    "3  Regex intent → plan of ≤ 4 tool calls",
    "4  MCP client dials /mcp with caller's token",
    "5  Summarise results + source record IDs",
    "6  Optional LLM rewrite; on failure keep",
    "   the source summary (never a 500)",
], 14, WHITE, 24)

rect(560, 914, 460, 210, stroke=BLUE)
title(582, 948, "MCP server  /mcp", "FastMCP · stateless Streamable HTTP · JSON", BLUE)
lines(582, 996, [
    "assess_route          find_shelter_route",
    "list_route_reports    get_local_conditions",
    "get_assistance_status find_nearby_facilities",
    "list_assistance_requests      (all read-only)",
], 13, WHITE, 21, mono=True)
text(582, 1100, "Host allow-list: localhost only (DNS-rebinding guard)", 13, MUTED)

arrow("M530 846 H556")
arrow("M790 874 V910", BLUE, marker="blue")
label(835, 898, "loopback", BLUE, "start", 12)

# column 3: services + contracts
rect(1050, 604, 460, 290)
title(1072, 638, "Shared domain services", "one implementation for REST, MCP, demo", GREEN)
rows = [
    ("CommunityService", "review lifecycle, optimistic versioning, audit log"),
    ("RouteAssessmentService", "screen ≤ 8 candidates, exclude, rank; no fake route"),
    ("MapStateService", "hazard zones, expiring shelters, shelter routing"),
    ("AuthService", "argon2 hashes, env-configured demo accounts"),
]
yy = 686
for name, desc in rows:
    text(1072, yy, name, 14, WHITE, 700)
    text(1072, yy + 20, desc, 13, MUTED)
    yy += 50

rect(1050, 914, 460, 210, stroke=GREEN, dashed=True)
title(1072, 948, "Contracts (typing.Protocol)", "open for extension", GREEN)
lines(1072, 994, [
    "RouteProvider  → GOneRouteProvider (OSRM)",
    "                 DemoRouteProvider (fixtures)",
    "                 ResponseBaseRouteProvider",
    "HazardPolicy   → ReportedHazardPolicy",
    "ReportSource   → CommunityService",
], 13, WHITE, 22, mono=True)

arrow("M1020 1010 H1046", BLUE, marker="blue")
arrow("M1280 894 V910", GREEN, marker="green")
# routers -> services via lane above the columns
arrow("M470 604 V590 H1250 V600")
label(860, 596, "direct REST calls", GOLD, "middle", 12)

# ---------------------------------------------------------------- data + external
band(1180, "State and outside services")
rect(60, 1200, 700, 250)
title(82, 1234, "Relational store", "SQLAlchemy 2 · psycopg 3 · create_all + additive column checks")
lines(82, 1284, [
    "PostgreSQL on Render (production — never falls back)",
    "SQLite  backend/waysignal-demo.db  (isolated demo mode)",
    "SQLite  fallback in local dev if Postgres is down",
], 14, WHITE, 23)
text(82, 1370, "G-one", 13, GOLD, 700)
text(140, 1370, "hazard_reports · emergencies · dispatch_reviews", 13, MUTED, mono=True)
text(82, 1396, "WaySignal", 13, GREEN, 700)
text(170, 1396, "waysignal_hazard_reviews · _review_events", 13, MUTED, mono=True)
text(170, 1418, "waysignal_observations · waysignal_shelters", 13, MUTED, mono=True)

rect(790, 1200, 750, 250)
title(812, 1234, "External providers", "called server-side with httpx; keys never reach clients")
ext = [
    ("OSRM", "driving route candidates + turn steps", WHITE, False),
    ("Open-Meteo", "precipitation forecast + river discharge", WHITE, False),
    ("Overpass (OSM)", "nearby facilities for the citizen map", WHITE, False),
    ("ArcGIS", "reverse geocoding for request locations", WHITE, False),
    ("OpenAI Responses", "optional; store:false; off without a key", MUTED, True),
]
yy = 1284
for name, desc, col, optional in ext:
    text(812, yy, name, 14, col, 700)
    text(975, yy, desc, 14, MUTED)
    yy += 29
text(812, 1440, "Apple MapKit tiles (iOS) and OSM tiles (web) load directly on the client.", 13, DIM)

arrow("M410 1150 V1196")
label(420, 1172, "SQL", GOLD, "start", 12)
arrow("M1165 1150 V1196")
label(1178, 1172, "HTTPS + timeouts · failure → 502, no route", GOLD, "start", 12)

# ---------------------------------------------------------------- deploy
band(1480, "Build and deploy")
rect(60, 1500, 1480, 100)
lines(82, 1534, [
    "Dockerfile: node:24 builds frontend/dist → python:3.12-slim, runs as non-root uid 10001  ·  render.yaml: Render web service + managed Postgres, JWT_SECRET generated",
    "GitHub Actions (macos-15): signed iOS Simulator build  ·  Local: scripts/run-ios-demo.sh starts the demo API on :8000 and launches the simulator",
], 14, WHITE, 26)

# legend
lx = 1070
add(f'<line x1="{lx}" y1="96" x2="{lx + 34}" y2="96" stroke="{GOLD}" stroke-width="2"/>')
text(lx + 42, 101, "REST / SQL / HTTPS", 13, MUTED)
add(f'<line x1="{lx + 210}" y1="96" x2="{lx + 244}" y2="96" stroke="{BLUE}" stroke-width="2"/>')
text(lx + 252, 101, "MCP", 13, MUTED)
add(f'<line x1="{lx + 310}" y1="96" x2="{lx + 344}" y2="96" stroke="{GREEN}" stroke-width="2"/>')
text(lx + 352, 101, "implements", 13, MUTED)

add("</g></svg>")
OUT.write_text("\n".join(parts), encoding="utf-8")
print(f"wrote {OUT}")
