"""Thin HTTP entry points for WaySignal's shared services."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.v1.hazards import signed_reporter
from app.core.database import get_db
from app.waysignal.community import CommunityService, ReviewInput
from app.waysignal.domain import AssessmentInput
from app.waysignal.routes import route_provider, RouteAssessmentService
from app.waysignal.guide import GuideInput, source_summary
from app.waysignal.assistant import ChatInput, chat, AssistantBodyRoute

router = APIRouter()
assistant_router = APIRouter(route_class=AssistantBodyRoute)


@assistant_router.post("/assistant")
async def assistant(payload: ChatInput, request: Request, actor: dict = Depends(signed_reporter)):
    return await chat(payload, request.headers["authorization"])


router.include_router(assistant_router)


from app.api.v1.hazards import HazardCreate, create_hazard, BoundedBodyRoute
from sqlalchemy.exc import IntegrityError
from app.waysignal.community import Observation
from pydantic import Field
from datetime import datetime, timezone


class ObservationInput(HazardCreate):
    note: str = Field(default="", max_length=500)


observation_router = APIRouter(route_class=BoundedBodyRoute)


@observation_router.post("/community", status_code=201)
def publish_observation(payload: ObservationInput, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    base = HazardCreate.model_validate(payload.model_dump(exclude={"note"}))
    record = create_hazard(base, actor, db)
    existing = db.get(Observation, record.id)
    if existing and existing.note != payload.note:
        raise HTTPException(409, "This submission has already been saved with a different note.")
    if existing is None:
        db.add(Observation(hazard_id=record.id, note=payload.note, observed_at=datetime.now(timezone.utc)))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            winner = db.get(Observation, record.id)
            if winner is None or winner.note != payload.note:
                raise HTTPException(409, "Another submission already saved this observation.") from None
    return record


router.include_router(observation_router)


@router.get("/community")
def community(response: Response, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return CommunityService(db, actor).reports()


@router.post("/community/{hazard_id}/review")
def review(hazard_id: str, payload: ReviewInput, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return CommunityService(db, actor).review(hazard_id, payload)


@router.get("/community/{hazard_id}/history")
def history(hazard_id: str, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return CommunityService(db, actor).history(hazard_id)


@router.post("/routes/assess")
async def assess(payload: AssessmentInput, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return await RouteAssessmentService(route_provider(), CommunityService(db, actor)).assess(payload)


@router.post("/guide")
async def guide(payload: GuideInput, request: Request, actor: dict = Depends(signed_reporter)):
    return await source_summary(payload, request.headers["authorization"])


@router.get("/scenario")
def scenario_info(response: Response):
    from app.waysignal.scenario import info
    response.headers["Cache-Control"] = "no-store"
    return info()


@router.post("/scenario/reset")
def reset_scenario(actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    from app.waysignal.scenario import seed
    if actor["role"] != "worker":
        raise HTTPException(403, "Only responders can reset the scripted exercise.")
    return seed(db, reset=True)


from app.waysignal.map_state import MapStateService, ShelterInput, ShelterRouteInput
from app.waysignal.domain import Coordinate


@router.get('/map-state')
def map_state(response: Response, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return MapStateService(db, actor).snapshot()


@router.post('/shelters', status_code=201)
def add_shelter(payload: ShelterInput, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return MapStateService(db, actor).create_shelter(payload)


@router.post('/shelters/{key}/close')
def close_shelter(key: str, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return MapStateService(db, actor).close_shelter(key)


@router.post('/routes/shelter')
async def shelter_route(payload: ShelterRouteInput, actor: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    return await MapStateService(db, actor).route_to_shelter(payload, payload.shelter_id)


from app.waysignal.responder_routes import router as responder_route_router
router.include_router(responder_route_router)
