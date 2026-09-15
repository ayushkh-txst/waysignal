"""Read-only responder directions to the latest stored request location."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy.orm import Session

from app.api.v1.emergencies import Emergency
from app.api.v1.hazards import signed_reporter
from app.core.config import settings
from app.core.database import get_db
from app.waysignal.community import CommunityService
from app.waysignal.domain import AssessmentInput, Coordinate
from app.waysignal.map_state import ShelterRoutePolicy
from app.waysignal.routes import GOneRouteProvider, RouteAssessmentService

router = APIRouter()
RESPONSE_BASE = Coordinate(latitude=27.7192, longitude=85.321)


class ResponderRouteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Coordinate | None = None
    origin_source: Literal["device", "manual", "response_base"] = "device"

    @model_validator(mode="after")
    def validate_origin(self):
        if self.origin_source == "response_base":
            if self.origin is not None:
                raise ValueError("The response base is configured by the server.")
        elif self.origin is None:
            raise ValueError("A starting location is required.")
        return self


class ResponseBaseRouteProvider:
    """Explicit local walkthrough, independent of live driving directions."""
    is_simulated = True

    async def candidates(self, request):
        from app.waysignal.scenario import assert_demo_area
        from math import hypot, cos, radians
        assert_demo_area(request.destination.latitude, request.destination.longitude)
        a = [request.origin.longitude, request.origin.latitude]
        b = [request.destination.longitude, request.destination.latitude]
        # Different approach corridors let reported hazards change the chosen route.
        paths = [[a, b], [a, [a[0] - .003, a[1]], [b[0] - .003, b[1]], b],
                 [a, [a[0], a[1] + .003], [b[0], a[1] + .003], b]]
        candidates = []
        for path in paths:
            distance = sum(hypot((v[0]-u[0]) * cos(radians(u[1])), v[1]-u[1]) * 111_195
                           for u, v in zip(path, path[1:]))
            candidates.append({"geometry": {"coordinates": path}, "distance": distance,
                "duration": distance / 4, "legs": [{"steps": [{"distance": distance,
                    "maneuver": {"instruction": "Follow the illustrated approach to the request location."}}]}]})
        return candidates


@router.post("/incidents/{request_id}/route")
async def responder_route(request_id: str, payload: ResponderRouteInput, response: Response,
                          actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    if actor["role"] != "worker":
        raise HTTPException(403, "Only admins can route to assistance requests.")
    record = db.get(Emergency, request_id)
    if record is None:
        raise HTTPException(404, "This assistance request no longer exists. Refresh Incidents.")
    if record.status in {"resolved", "cancelled"}:
        raise HTTPException(409, "This request is closed. Choose an active request.")
    origin = payload.origin
    provider = GOneRouteProvider()
    if payload.origin_source == "response_base":
        if not settings.waysignal_demo_mode:
            raise HTTPException(409, "Response base is available only in the Riverside scenario.")
        origin, provider = RESPONSE_BASE, ResponseBaseRouteProvider()
    # A device/manual origin ALWAYS uses road routing, even on a scenario server.
    destination = Coordinate(latitude=record.latitude, longitude=record.longitude)
    point_version = record.location_updated_at
    assessment = await RouteAssessmentService(provider, CommunityService(db, actor), [ShelterRoutePolicy()]).assess(
        AssessmentInput(origin=origin, destination=destination, destination_name=record.citizen_name))
    # Do not hand out a route that became stale while the provider was responding.
    db.refresh(record)
    if record.status in {"resolved", "cancelled"} or record.location_updated_at != point_version or \
            (record.latitude, record.longitude) != (destination.latitude, destination.longitude):
        raise HTTPException(409, "The request changed while directions were loading. Refresh the route.")
    response.headers["Cache-Control"] = "no-store"
    return {"request_id": record.id, "citizen_name": record.citizen_name,
            "origin": origin.model_dump(), "destination": destination.model_dump(),
            "origin_source": payload.origin_source, "location_updated_at": record.location_updated_at,
            "assessment": assessment}
