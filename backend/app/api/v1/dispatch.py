"""Worker notification inbox and dispatch assistance over persisted citizen SOS."""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, String, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.api.v1.emergencies import Emergency, EmergencyRecord
from app.api.v1.hazards import signed_reporter
from app.core.database import Base, get_db
from app.services import dispatch_ai, dispatch_contacts

router = APIRouter()
ACTIVE = ["submitted", "assigned", "en_route"]

class DispatchReview(Base):
    __tablename__ = "dispatch_reviews"
    worker_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    revision: Mapped[str] = mapped_column(String(64))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def worker(reporter: dict = Depends(signed_reporter)) -> dict:
    if reporter["role"] != "worker":
        raise HTTPException(403, "Only responders can read dispatch assistance")
    return reporter


def revision(record: Emergency) -> str:
    # Navigation heartbeats do not create alerts. Material location/report changes do.
    value = [record.id, record.emergency_type, round(record.latitude, 3), round(record.longitude, 3),
             record.people_count, record.notes, record.risk_level]
    return hashlib.sha256(json.dumps(value, ensure_ascii=True).encode()).hexdigest()


def brief(record: Emergency) -> dict:
    services = {"medical": ["Ambulance / EMS"], "rescue": ["Fire & rescue", "Rescue coordination"],
                "evacuation": ["Rescue coordination", "Evacuation transport"]}[record.emergency_type]
    return {"incident_id": record.id, "revision": revision(record), "emergency_type": record.emergency_type,
            "people_count": record.people_count, "latitude": record.latitude, "longitude": record.longitude,
            "created_at": EmergencyRecord.model_validate(record).created_at,
            "title": f"{record.emergency_type.capitalize()} assistance requested",
            "summary": f"{record.people_count} {'person requests' if record.people_count == 1 else 'people request'} {record.emergency_type} assistance. Verify the latest reported location and coordinate the appropriate response.",
            "suggested_services": services, "risk_context": record.risk_level or "not recorded",
            "status": record.status}


def get_incident(db: Session, incident_id: str) -> Emergency:
    record = db.get(Emergency, incident_id)
    if record is None or record.is_demo:
        raise HTTPException(404, "Live incident not found")
    if record.status not in ACTIVE:
        raise HTTPException(409, "This incident is closed")
    return record


class RevisionInput(BaseModel):
    revision: str = Field(pattern=r"^[a-f0-9]{64}$")


@router.get("/notifications")
def notifications(response: Response, reporter: dict = Depends(worker), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    rows = db.execute(select(Emergency, DispatchReview).outerjoin(DispatchReview,
        (DispatchReview.incident_id == Emergency.id) & (DispatchReview.worker_id == reporter["sub"])).where(
        Emergency.is_demo.is_(False), Emergency.status.in_(ACTIVE)).order_by(Emergency.created_at.desc()).limit(2501)).all()
    if len(rows) > 2500:
        raise HTTPException(503, "Dispatch inbox exceeds the supported active incident limit")
    items = [{**brief(record), "reviewed": bool(review and review.revision == revision(record))} for record, review in rows]
    return {"items": items, "unread_count": sum(not item["reviewed"] for item in items),
            "checked_at": datetime.now(timezone.utc)}


@router.get("/incidents/{incident_id}")
async def assistance(incident_id: str, response: Response,
                     directory: Literal["US", "NP"] | None = Query(None),
                     _: dict = Depends(worker), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    record = get_incident(db, incident_id)
    lat, lon = record.latitude, record.longitude
    before = revision(record)
    try:
        location = await asyncio.wait_for(dispatch_contacts.resolve_location(lat, lon), timeout=4)
    except Exception:
        location = {"label": f"{lat:.5f}, {lon:.5f}", "country": None, "city": "", "region": "", "source": "coordinates"}
    # A GPS update or closure during the provider call must not return obsolete contacts.
    db.refresh(record)
    if record.status not in ACTIVE or (record.latitude, record.longitude) != (lat, lon) or revision(record) != before:
        raise HTTPException(409, "Incident changed during lookup. Refresh dispatch assistance.")
    saved = EmergencyRecord.model_validate(record)
    age = max(0, (datetime.now(timezone.utc) - (saved.location_updated_at or saved.created_at)).total_seconds())
    directory_result = dispatch_contacts.directory_for(location, directory)
    preferred = brief(record)["suggested_services"]
    directory_result["contacts"].sort(key=lambda c: (not c["emergency"], not any(s in c["services"] for s in preferred)))
    return {**brief(record), "location": location, "directory": directory_result, "notes": record.notes,
            "accuracy_m": record.accuracy_m, "location_age_seconds": round(age),
            "location_stale": saved.location_updated_at is None or age > 300,
            "ai_available": dispatch_ai.configured(), "summary_source": "Saved incident fields",
            "handoff": f"JalRakshak request {record.id}: {record.emergency_type}; {record.people_count} people. Reported GPS {lat:.5f}, {lon:.5f}. Location: {location['label']}. Location age: {round(age)} seconds. Citizen note (unverified): {record.notes or 'None provided'}. Caller callback number: not collected by this app."}


@router.post("/incidents/{incident_id}/review")
def mark_reviewed(incident_id: str, payload: RevisionInput, response: Response,
                  reporter: dict = Depends(worker), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    record = get_incident(db, incident_id)
    if payload.revision != revision(record):
        raise HTTPException(409, "The report changed. Refresh before marking reviewed.")
    key = (reporter["sub"], incident_id)
    review = db.get(DispatchReview, key)
    if not review:
        review = DispatchReview(worker_id=key[0], incident_id=key[1]); db.add(review)
    review.revision = payload.revision
    review.reviewed_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        review = db.get(DispatchReview, key)
        if not review or review.revision != payload.revision:
            raise HTTPException(409, "Review changed concurrently. Refresh the inbox.")
    return {"incident_id": incident_id, "revision": payload.revision, "reviewed": True}


_ai_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_ai_requests: dict[tuple[str, str], asyncio.Task] = {}

@router.post("/incidents/{incident_id}/ai-review")
async def ai_review(incident_id: str, payload: RevisionInput, response: Response,
                    _: dict = Depends(worker), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    record = get_incident(db, incident_id)
    if payload.revision != revision(record):
        raise HTTPException(409, "The report changed. Refresh before AI review.")
    key = (record.id, payload.revision)
    cached = _ai_cache.get(key)
    if cached and time.monotonic() - cached[0] < 300:
        return {"revision": payload.revision, **cached[1]}
    task = _ai_requests.get(key)
    if task is None:
        if len(_ai_requests) >= 4:
            raise HTTPException(429, "AI review is busy. Retry shortly; contacts remain available.")
        task = asyncio.create_task(asyncio.wait_for(dispatch_ai.review_note(record.notes), timeout=8.5))
        _ai_requests[key] = task
        def cleanup(done):
            if _ai_requests.get(key) is done:
                _ai_requests.pop(key, None)
        task.add_done_callback(cleanup)
    try:
        result = await asyncio.wait_for(asyncio.shield(task), timeout=9)
    except Exception:
        result = {"status": "unavailable", "signals": [], "notice": "AI note review is unavailable. Use the original report and verified contacts."}
    finally:
        if task.done() and _ai_requests.get(key) is task:
            _ai_requests.pop(key, None)
    db.refresh(record)
    if record.status not in ACTIVE or revision(record) != payload.revision:
        raise HTTPException(409, "Incident changed during AI review. Refresh the report.")
    if len(_ai_cache) >= 500:
        _ai_cache.pop(min(_ai_cache, key=lambda item: _ai_cache[item][0]))
    if result["status"] == "complete":
        _ai_cache[key] = (time.monotonic(), result)
    return {"revision": payload.revision, **result}
