"""Explicit synthetic exercise. Enabled only on a dedicated development database."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.waysignal.domain import AssessmentInput

ORIGIN = {"latitude": 27.7172, "longitude": 85.321}
DESTINATION = {"latitude": 27.7172, "longitude": 85.333}
TITLE = "Riverside storm exercise"
NOTICE = "DEMO SCENARIO — synthetic conditions, places, routes and people. Not a live incident or emergency service."
REPORTS = [
    ("WS-DEMO-R104", "road_blocked", 27.7172, 85.327, "unreviewed", 4,
     "Demo observation: a fallen barrier blocks Riverside Road. Review this report to change the selected route."),
    ("WS-DEMO-R105", "debris", 27.7192, 85.327, "unreviewed", 8,
     "Demo observation: scattered debris on the northern alternative. Field review pending."),
    ("WS-DEMO-R101", "flooded_road", 27.7148, 85.327, "reviewed_active", 12,
     "Demo responder review: the southern crossing remains blocked in this exercise."),
    ("WS-DEMO-R108", "flooded_road", 27.722, 85.334, "reviewed_active", 18,
     "Demo responder review: standing water near the eastern service road."),
    ("WS-DEMO-R109", "debris", 27.715, 85.335, "resolved", 25,
     "Demo responder update: this separate debris report is resolved."),
]
REQUESTS = [
    ("WS-DEMO-H208", "citizen-demo", "Demo Citizen", "evacuation", "submitted", 3, 4, 27.7172, 85.321, "Demo exercise: three participants need transport from the starting point."),
    ("WS-DEMO-H209", "citizen-demo", "Demo Citizen", "medical", "assigned", 1, 12, 27.7185, 85.324, "Demo exercise: one participant needs accessible transport."),
    ("WS-DEMO-H210", "citizen-demo", "Demo Citizen", "rescue", "en_route", 4, 20, 27.716, 85.329, "Demo exercise: a response team is travelling to the meeting point."),
    ("WS-DEMO-H211", "citizen-demo", "Demo Citizen", "evacuation", "resolved", 2, 60, 27.720, 85.331, "Demo exercise: transport task complete; road reports retain their own status."),
    ("WS-DEMO-H212", "scenario-participant-2", "Demo neighborhood group", "evacuation", "submitted", 6, 7, 27.715, 85.325, "Demo exercise: group awaiting a transport assignment."),
    ("WS-DEMO-H213", "scenario-participant-3", "Demo community volunteer", "medical", "en_route", 1, 24, 27.721, 85.328, "Demo exercise: accessible vehicle travelling to pickup."),
]


def info() -> dict:
    if not settings.waysignal_demo_mode:
        return {"enabled": False, "title": "Live data", "notice": "", "origin": None, "destination": None, "destination_name": None}
    return {"enabled": True, "title": TITLE, "notice": NOTICE, "origin": ORIGIN,
            "destination": DESTINATION, "destination_name": "Hilltop Community Centre"}


def validate_demo_database() -> None:
    # Refuse a demo flag on a live/production database, even if configured accidentally.
    if settings.waysignal_demo_mode and (settings.environment == "production" or
            not settings.database_url.startswith("sqlite:") or not settings.database_url.endswith("waysignal-demo.db")):
        raise RuntimeError("Demo mode requires a development SQLite database named waysignal-demo.db. Use scripts/start-demo.sh.")


def assert_demo_area(latitude: float, longitude: float) -> None:
    if abs(latitude - ORIGIN["latitude"]) > .04 or abs(longitude - ORIGIN["longitude"]) > .04:
        raise HTTPException(422, "This demo uses a fixed exercise area. Choose the demo starting point; restart in live mode for your real location.")


def environmental_snapshot(latitude: float, longitude: float) -> dict:
    assert_demo_area(latitude, longitude)
    return {"latitude": latitude, "longitude": longitude, "observed_at": datetime.now(timezone.utc).isoformat(),
        "source": "Synthetic WaySignal demo fixture — not a weather observation",
        "temperature_c": 24.6, "precipitation_next_6h_mm": 52.4, "precipitation_probability_max_6h": 92,
        "river_discharge_m3s": 184.0, "river_discharge_tomorrow_m3s": 239.2, "river_trend_percent": 30.0,
        "prototype_risk_score": 78, "prototype_risk_level": "high"}


def facilities() -> list[dict]:
    return [
        {"id": "WS-DEMO-P1", "name": "Hilltop Community Centre", "type": "community_centre", **DESTINATION, "priority": 0},
        {"id": "WS-DEMO-P2", "name": "North Clinic", "type": "clinic", "latitude": 27.721, "longitude": 85.329, "priority": 1},
        {"id": "WS-DEMO-P3", "name": "Riverside School", "type": "school", "latitude": 27.715, "longitude": 85.323, "priority": 2},
        {"id": "WS-DEMO-P4", "name": "Supply Point", "type": "community_centre", "latitude": 27.718, "longitude": 85.335, "priority": 3},
    ]


class DemoRouteProvider:
    async def candidates(self, request: AssessmentInput) -> list[dict]:
        assert_demo_area(request.origin.latitude, request.origin.longitude)
        assert_demo_area(request.destination.latitude, request.destination.longitude)
        start = [request.origin.longitude, request.origin.latitude]
        end = [request.destination.longitude, request.destination.latitude]
        paths = [
            ([start, [85.327, 27.7172], end], 1400, 300),
            ([start, [85.321, 27.7192], [85.327, 27.7192], [85.333, 27.7192], end], 1900, 420),
            ([start, [85.321, 27.7148], [85.327, 27.7148], [85.333, 27.7148], end], 2100, 480),
        ]
        return [{"geometry": {"coordinates": deepcopy(points)}, "distance": distance, "duration": duration,
                 "legs": [{"steps": [{"distance": distance, "duration": duration, "name": "Demo route",
                     "maneuver": {"type": "depart", "instruction": "Follow the simulated exercise route."}}]}]}
                for points, distance, duration in paths]


def seed(db: Session, reset: bool = False) -> dict:
    from app.api.v1.hazards import Hazard
    from app.api.v1.emergencies import Emergency
    from app.waysignal.community import Review, ReviewEvent
    validate_demo_database()
    if not settings.waysignal_demo_mode:
        raise HTTPException(409, "Start the dedicated demo server to load this exercise.")
    from app.waysignal.map_state import Shelter
    shelter_id = 'WS-DEMO-S1'
    if reset:
        db.execute(delete(Shelter).where(Shelter.id == shelter_id))
        db.flush()
    if db.get(Shelter, shelter_id) is None:
        checked = datetime.now(timezone.utc)
        db.add(Shelter(id=shelter_id, name='Hilltop Community Centre', **DESTINATION,
            note='Simulated open shelter for the Riverside exercise.', actor='worker-demo',
            checked_at=checked, expires_at=checked + timedelta(hours=12), status='open'))
    ids = [item[0] for item in REPORTS]
    if reset:
        db.execute(delete(ReviewEvent).where(ReviewEvent.hazard_id.in_(ids)))
        db.execute(delete(Review).where(Review.hazard_id.in_(ids)))
        db.execute(delete(Hazard).where(Hazard.id.in_(ids)))
        db.execute(delete(Emergency).where(Emergency.id.in_([item[0] for item in REQUESTS])))
        db.flush()
    now = datetime.now(timezone.utc)
    for key, kind, latitude, longitude, state, age, note in REPORTS:
        if db.get(Hazard, key): continue
        observed = now - timedelta(minutes=age)
        resolved = state == "resolved"
        db.add(Hazard(id=key, client_request_id=str(uuid5(NAMESPACE_URL, key)), request_hash="synthetic-demo",
            reporter_id="citizen-demo", reporter_role="citizen", source="user_reported", kind=kind,
            latitude=latitude, longitude=longitude, accuracy_m=10, status="resolved" if resolved else "active",
            created_at=observed, updated_at=observed, resolved_at=observed if resolved else None,
            resolved_by="worker-demo" if resolved else None))
        if state in {"reviewed_active", "resolved"}:
            db.add(Review(hazard_id=key, decision="reviewed_active", note=note, actor="worker-demo", reviewed_at=observed, version=1))
            db.add(ReviewEvent(id=str(uuid5(NAMESPACE_URL, "review:"+key)), hazard_id=key, decision="reviewed_active",
                note=note, actor="worker-demo", created_at=observed))
    for key, citizen, name, kind, state, people, age, latitude, longitude, note in REQUESTS:
        if db.get(Emergency, key): continue
        created = now - timedelta(minutes=age)
        assigned = state in {"assigned", "en_route", "resolved"}
        travelling = state in {"en_route", "resolved"}
        db.add(Emergency(id=key, citizen_id=citizen, citizen_name=name, emergency_type=kind,
            latitude=latitude, longitude=longitude, accuracy_m=12, people_count=people, notes=note,
            risk_score=78, risk_level="high", precipitation_next_6h_mm=52.4, river_discharge_m3s=184,
            status=state, created_at=created, updated_at=now - timedelta(minutes=1), is_demo=True,
            responder_id="worker-demo" if assigned else None, responder_name="Demo response team" if assigned else None,
            acknowledged_at=created + timedelta(minutes=1) if assigned else None,
            assigned_at=created + timedelta(minutes=2) if assigned else None,
            en_route_at=created + timedelta(minutes=4) if travelling else None,
            on_scene_at=created + timedelta(minutes=12) if state == "resolved" else None,
            resolved_at=created + timedelta(minutes=18) if state == "resolved" else None,
            location_updated_at=now - timedelta(minutes=1),
            responder_latitude=latitude + .001 if assigned else None,
            responder_longitude=longitude - .001 if assigned else None,
            responder_eta_seconds=300 if state == "en_route" else 0 if state == "resolved" else None,
            responder_distance_m=650 if state == "en_route" else 0 if state == "resolved" else None,
            eta_updated_at=now if travelling else None,
            navigation_status=state if assigned else None))
    db.commit()
    return {**info(), "reports": len(REPORTS), "assistance_requests": len(REQUESTS), "reset": reset}


async def legacy_route(latitude: float, longitude: float) -> dict:
    """Adapt the shared reviewed route result to G-one's existing web contract."""
    from app.core import database
    from app.waysignal.community import CommunityService
    from app.waysignal.routes import RouteAssessmentService
    request = AssessmentInput(origin={"latitude": latitude, "longitude": longitude},
        destination=DESTINATION, destination_name=info()["destination_name"])
    with database.SessionLocal() as db:
        assessment = await RouteAssessmentService(DemoRouteProvider(), CommunityService(db, {"sub": "scenario", "role": "citizen"})).assess(request)
    candidates = assessment["candidates"]
    selected = next((c for c in candidates if c["id"] == assessment["selected_id"]), None)
    shown = selected or candidates[0]
    return {"destination_name": request.destination_name, "destination_type": "community_centre",
        "destination_latitude": DESTINATION["latitude"], "destination_longitude": DESTINATION["longitude"],
        "distance_m": shown["distance_m"], "duration_s": shown["duration_s"], "geometry": shown["geometry"],
        "steps": [{"instruction": "Demo only: follow the schematic selected candidate.", "distance_m": shown["distance_m"], "duration_s": shown["duration_s"]}] if selected else [],
        "alternatives_considered": len(candidates), "prototype_safety_score": 70 if selected else 0,
        "reasons": ["Synthetic exercise: route geometry, travel times and prototype score are simulated.",
            "Uses the same reviewed-report policies as the native app and MCP."],
        "source": "Synthetic WaySignal demo scenario", "warning": assessment["notice"], "is_demo": True,
        "screening_status": "complete", "recommended_count": 1 if selected else 0,
        "rejected_count": sum(c["excluded"] for c in candidates), "viable_count": sum(not c["excluded"] for c in candidates),
        "screened_routes": [{"id": c["id"], "status": "rejected" if c["excluded"] else "recommended" if c["id"] == assessment["selected_id"] else "viable",
            "distance_m": c["distance_m"], "duration_s": c["duration_s"], "geometry": c["geometry"],
            "rejection_reasons": [f["label"] + " · " + f["report_id"] for f in c["findings"] if f["disposition"] == "exclude"]} for c in candidates]}
