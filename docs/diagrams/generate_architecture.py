"""Regenerate the README's self-contained SVG: python docs/diagrams/generate_architecture.py."""
from html import escape
from pathlib import Path

OUT = Path(__file__).with_name("g-one-architecture.svg")
BG, PANEL, CARD = "#101516", "#171e20", "#20292c"
WHITE, MUTED, GOLD, BLUE, GREEN = "#f4f1e9", "#b0bec1", "#d6b765", "#87c7e6", "#8dd4b0"
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1400" viewBox="0 0 1600 1400" role="img" aria-labelledby="title desc">
<title id="title">G-One system architecture</title>
<desc id="desc">Citizen and admin React dashboards call a FastAPI backend with JWT authentication and up to five configured demo accounts. Safety and routing use Open-Meteo, OSRM, Overpass, and ArcGIS. Emergencies, hazards, and dispatch reviews are stored in PostgreSQL; reports query saved records. OpenAI note analysis is optional. Browser maps load external tiles and embeds. The release path builds the frontend and Python server into one Docker web service on Render with a managed PostgreSQL database.</desc>
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="{GOLD}" stroke-width="1.5"/></marker>
<marker id="blue-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="{BLUE}" stroke-width="1.5"/></marker>
</defs>
<rect width="1600" height="1400" rx="24" fill="{BG}"/>
<g font-family="Arial, Helvetica, sans-serif">''']


def rect(x, y, w, h, fill=CARD, stroke="#354247", radius=14, dashed=False):
    dash = ' stroke-dasharray="7 6"' if dashed else ''
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dash}/>')


def text(x, y, value, size=22, color=WHITE, weight=400, spacing=None):
    space = f' letter-spacing="{spacing}"' if spacing is not None else ''
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}"{space}>{escape(value)}</text>')


def lines(x, y, values, size=21, color=MUTED, step=30):
    for i, value in enumerate(values):
        text(x, y + i * step, value, size, color)


def edge(points, blue=False, dashed=False, both=False):
    color, marker = (BLUE, "blue-arrow") if blue else (GOLD, "arrow")
    dash = ' stroke-dasharray="7 6"' if dashed else ''
    start = f' marker-start="url(#{marker})"' if both else ''
    parts.append(f'<path d="{points}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" marker-end="url(#{marker})"{start}{dash}/>')


ICONS = {
    "shield": '<path d="M12 2 21 6v6c0 6-9 10-9 10S3 18 3 12V6z"/><path d="M5 13c3-4 5 4 8 0s5 0 6-1"/>',
    "person": '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
    "bell": '<path d="M5 16V9a7 7 0 0 1 14 0v7l2 3H3zM9 22h6"/>',
    "lock": '<rect x="4" y="10" width="16" height="12" rx="2"/><path d="M7 10V6a5 5 0 0 1 10 0v4M12 15v3"/>',
    "cloud": '<path d="M6 18a5 5 0 1 1 1-10 7 7 0 0 1 13 2 4 4 0 0 1-1 8zM7 21l-1 2M13 21l-1 2M19 21l-1 2"/>',
    "map": '<path d="m2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3zM9 2v17M15 5v17"/>',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/>',
    "spark": '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
    "git": '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12M18 9v2c0 5-12 0-12 6"/>',
    "box": '<path d="m12 2 10 5v10l-10 5-10-5V7zM2 7l10 5 10-5M12 12v10M7 4.5l10 5"/>',
    "server": '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6h.1M6 17h.1M10 6h8M10 17h8"/>',
}


def icon(name, x, y, size=28, color=GOLD):
    parts.append(f'<g transform="translate({x} {y}) scale({size / 24})" fill="none" stroke="{color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>')


def heading(x, y, number, title, sub, w):
    text(x + 24, y + 37, number, 17, GOLD, 700, 2)
    text(x + 65, y + 38, title, 24, WHITE, 700)
    text(x + 24, y + 75, sub, 20, MUTED)
    parts.append(f'<path d="M{x + 24} {y + 97}H{x + w - 24}" stroke="#354247"/>')


# Title and legend.
rect(56, 47, 68, 68, "#302b1c", "#756336", 18)
icon("shield", 72, 59, 38)
text(144, 92, "G-One", 50, WHITE, 700)
text(146, 126, "FLOOD AWARENESS · EMERGENCY COORDINATION", 17, GOLD, 700, 2)
text(1050, 74, "SYSTEM ARCHITECTURE", 24, WHITE, 700, 1)
text(1050, 108, "HackRice 16 · demo hosted on Render", 19, MUTED)
parts.append('<path d="M56 157H1544" stroke="#354247"/>')

# Three runtime boundaries. Code stays in one API service.
rect(56, 196, 360, 684, PANEL, "#665c3c")
rect(524, 196, 540, 684, PANEL, "#665c3c")
rect(1172, 196, 372, 684, PANEL, "#385565")
heading(56, 196, "01", "Browser clients", "React · TypeScript · Vite", 360)
heading(524, 196, "02", "Application backend", "FastAPI · Python · /api/v1", 540)
heading(1172, 196, "03", "External services", "HTTP integrations", 372)

# Citizen and responder roles share one frontend.
rect(80, 320, 312, 157)
icon("person", 100, 343)
text(142, 366, "Citizen dashboard", 23, WHITE, 700)
lines(100, 407, ["GPS + nearby facilities", "Routes · hazards · SOS"], 21)
rect(80, 501, 312, 157)
icon("bell", 100, 524)
text(142, 547, "Admin dashboard", 23, WHITE, 700)
lines(100, 588, ["Incident queue + alerts", "Coordination · reports"], 21)
text(80, 706, "Maps + browser GPS", 21, WHITE, 700)
lines(80, 745, ["Updates through REST polling", "Incidents / dispatch: 5 seconds", "Reports: 15 seconds"], 20, MUTED, 31)

# API entry point and logical modules.
rect(548, 320, 492, 103, "#2c2a20", "#756336")
icon("lock", 568, 343)
text(610, 366, "JWT auth + role checks", 23, WHITE, 700)
text(568, 401, "Up to five demo accounts in server memory", 20, MUTED)
rect(548, 452, 492, 104)
text(570, 487, "Safety + routing", 25, WHITE, 700)
lines(570, 522, ["Weather context · facilities · road routes"], 21)
rect(548, 584, 492, 104)
text(570, 619, "Emergency + hazard records", 25, WHITE, 700)
text(570, 655, "SOS · location updates · incident lifecycle", 21, MUTED)
rect(548, 716, 492, 111)
text(570, 752, "Dispatch assistance + reports", 25, WHITE, 700)
text(570, 788, "Contact directory · note review · CSV", 21, MUTED)
text(548, 859, "Logical modules within one FastAPI service", 19, MUTED)

# External providers; AI is explicitly optional.
rect(1196, 320, 324, 147)
icon("cloud", 1216, 342, color=BLUE)
text(1258, 365, "Open-Meteo", 25, WHITE, 700)
lines(1216, 407, ["Weather + Flood APIs", "Rainfall / river forecasts"], 20)
rect(1196, 495, 324, 167)
icon("map", 1216, 518, color=BLUE)
text(1258, 541, "Location + routes", 23, WHITE, 700)
lines(1216, 584, ["OSRM road routing", "Overpass / OSM facilities", "ArcGIS reverse geocoding"], 20, MUTED, 28)
rect(1196, 690, 324, 159, "#1b272e", "#54839b", dashed=True)
icon("spark", 1216, 711, color=BLUE)
text(1258, 735, "OpenAI · optional", 23, WHITE, 700)
lines(1216, 776, ["Evidence from citizen notes", "Enabled with key + model", "Contacts work without AI"], 19, MUTED, 27)

# Connections: all labels have their own clear space.
edge("M416 371 H548", both=True)
text(426, 340, "REST", 17, GOLD, 700)
text(426, 362, "+ JWT", 17, GOLD, 700)
edge("M794 423 V452")
edge("M1040 478 H1100 V393 H1196", blue=True)
edge("M1040 535 H1135 V575 H1196", blue=True)
edge("M1040 769 H1196", blue=True, dashed=True)
text(1075, 745, "on request", 16, BLUE)

# Persistence and direct browser map delivery.
rect(56, 961, 360, 143, PANEL, "#385565")
icon("map", 80, 982, color=BLUE)
text(124, 1006, "Map tiles + embeds", 23, WHITE, 700)
lines(80, 1048, ["OpenStreetMap · Esri tiles", "Google Maps county embeds"], 20)
edge("M236 880 V961", blue=True)
text(250, 923, "Browser requests", 18, BLUE)

rect(524, 961, 540, 143, "#1b2924", "#456c58")
icon("database", 548, 982, color=GREEN)
text(592, 1007, "PostgreSQL", 28, WHITE, 700)
text(805, 1007, "SQLAlchemy + psycopg", 19, MUTED)
lines(548, 1050, ["Emergencies · shared hazards · dispatch reviews", "Reports aggregate stored incident records"], 20)
edge("M794 880 V961", both=True)
text(810, 923, "Read / write", 19, GOLD)

text(1172, 937, "READING THIS DIAGRAM", 17, GOLD, 700, 1.2)
edge("M1176 973 H1217")
text(1235, 980, "App / storage traffic", 20, MUTED)
edge("M1176 1015 H1217", blue=True)
text(1235, 1022, "External requests", 20, MUTED)
edge("M1176 1057 H1217", blue=True, dashed=True)
text(1235, 1064, "Optional integration", 20, MUTED)

# Delivery pipeline for the hosted demo.
rect(56, 1152, 1488, 192, "#211f18", "#756336")
text(80, 1189, "RELEASE PATH", 17, GOLD, 700, 2)
text(267, 1189, "Dockerfile + render.yaml · frontend and API share one HTTPS URL", 20, MUTED)
rect(80, 1215, 394, 102, CARD, "#665c3c")
icon("git", 101, 1238)
text(145, 1259, "GitHub source", 25, WHITE, 700)
text(101, 1294, "feature/login-page-ui", 21, MUTED)
rect(593, 1215, 394, 102, CARD, "#665c3c")
icon("box", 614, 1238)
text(658, 1259, "Docker build", 25, WHITE, 700)
text(614, 1294, "Vite assets + Python API", 21, MUTED)
rect(1106, 1215, 414, 102, CARD, "#665c3c")
icon("server", 1127, 1238)
text(1171, 1259, "Render Blueprint", 25, WHITE, 700)
text(1127, 1294, "One HTTPS app + PostgreSQL", 21, MUTED)
edge("M474 1266 H593")
edge("M987 1266 H1106")
text(56, 1376, "G-One · HackRice 16", 18, MUTED)
text(1030, 1376, "Forecasts and reported hazards are not verified flood zones.", 16, MUTED)
parts.append("</g></svg>\n")
OUT.write_text("\n".join(parts))
print(OUT)
