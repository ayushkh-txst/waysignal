"""Thin HTTP entry points for WaySignal's shared services."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.v1.hazards import signed_reporter
from app.core.database import get_db
from app.waysignal.community import CommunityService, ReviewInput
from app.waysignal.domain import AssessmentInput
from app.waysignal.routes import route_provider, RouteAssessmentService
from app.waysignal.guide import GuideInput, source_summary

router = APIRouter()


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
