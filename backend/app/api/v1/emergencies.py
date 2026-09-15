from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base, get_db
from app.api.v1.hazards import signed_reporter

router = APIRouter()


def worker(reporter: dict = Depends(signed_reporter)) -> dict:
    if reporter["role"] != "worker":
        raise HTTPException(403, "Only responders can manage incident response.")
    return reporter


def accessible_emergency(db: Session, emergency_id: str, reporter: dict):
    record = db.get(Emergency, emergency_id)
    if record is None or (reporter["role"] != "worker" and record.citizen_id != reporter["sub"]):
        raise HTTPException(404, "Emergency request not found")
    return record


class EmergencyType(str, Enum):
    rescue = "rescue"
    medical = "medical"
    evacuation = "evacuation"


class EmergencyStatus(str, Enum):
    submitted = "submitted"
    assigned = "assigned"
    en_route = "en_route"
    resolved = "resolved"
    cancelled = "cancelled"


class NavigationStatus(str, Enum):
    assigned = "assigned"
    en_route = "en_route"
    approaching = "approaching"
    on_scene = "on_scene"
    resolved = "resolved"


class Emergency(Base):
    __tablename__ = "emergencies"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    citizen_id: Mapped[str] = mapped_column(String(128), index=True)
    citizen_name: Mapped[str] = mapped_column(String(160))
    emergency_type: Mapped[str] = mapped_column(String(32))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    people_count: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str] = mapped_column(Text, default="")
    risk_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(32), nullable=True)
    precipitation_next_6h_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    river_discharge_m3s: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default=EmergencyStatus.submitted.value, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    responder_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    responder_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    responder_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    responder_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    recommended_route: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    responder_eta_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    responder_distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    eta_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    route_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    navigation_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reroute_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    en_route_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    on_scene_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmergencyCreate(BaseModel):
    citizen_id: str
    citizen_name: str
    emergency_type: EmergencyType
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    people_count: int = Field(default=1, ge=1, le=50)
    notes: str = Field(default="", max_length=500)
    risk_score: int | None = Field(default=None, ge=0, le=100)
    risk_level: str | None = None
    precipitation_next_6h_mm: float | None = None
    river_discharge_m3s: float | None = None


class EmergencyUpdate(BaseModel):
    status: EmergencyStatus
    responder_id: str | None = None
    responder_name: str | None = None


class EmergencyLocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)


class EmergencyNavigationUpdate(BaseModel):
    responder_latitude: float = Field(ge=-90, le=90)
    responder_longitude: float = Field(ge=-180, le=180)
    recommended_route: dict | None = None
    responder_eta_seconds: int | None = Field(default=None, ge=0)
    responder_distance_m: float | None = Field(default=None, ge=0)
    navigation_status: NavigationStatus
    reroute_reason: str | None = Field(default=None, max_length=500)


class EmergencyRecord(EmergencyCreate):
    id: str
    status: EmergencyStatus
    created_at: datetime
    updated_at: datetime | None = None
    responder_id: str | None = None
    responder_name: str | None = None
    responder_latitude: float | None = None
    responder_longitude: float | None = None
    recommended_route: dict | None = None
    responder_eta_seconds: int | None = None
    responder_distance_m: float | None = None
    eta_updated_at: datetime | None = None
    route_updated_at: datetime | None = None
    navigation_status: NavigationStatus | None = None
    reroute_reason: str | None = None
    is_demo: bool = False
    acknowledged_at: datetime | None = None
    assigned_at: datetime | None = None
    en_route_at: datetime | None = None
    on_scene_at: datetime | None = None
    resolved_at: datetime | None = None
    location_updated_at: datetime | None = None

    @field_validator("created_at", "updated_at", "eta_updated_at", "route_updated_at",
                     "acknowledged_at", "assigned_at", "en_route_at", "on_scene_at",
                     "resolved_at", "location_updated_at", mode="after")
    @classmethod
    def timestamps_are_utc(cls, value):
        # SQLite drops timezone information. Never send these as browser-local time.
        return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value

    model_config = ConfigDict(from_attributes=True)


DEMO_INCIDENTS = [
    {"id":"DEMO-1042","citizen_id":"demo-meena","citizen_name":"Meena Devi","emergency_type":"rescue","latitude":27.7172,"longitude":85.3240,"accuracy_m":9.0,"people_count":4,"notes":"Family trapped near the ground floor. Water rising around the access road.","risk_score":87,"risk_level":"critical","precipitation_next_6h_mm":42.8,"river_discharge_m3s":183.4,"status":"en_route","responder_id":"demo-amit","responder_name":"Amit Kumar","minutes_ago":21},
    {"id":"DEMO-1039","citizen_id":"demo-bikash","citizen_name":"Bikash Rai","emergency_type":"medical","latitude":27.7098,"longitude":85.3314,"accuracy_m":14.0,"people_count":1,"notes":"Medical assistance requested for an elderly resident unable to evacuate independently.","risk_score":71,"risk_level":"high","precipitation_next_6h_mm":31.2,"river_discharge_m3s":158.1,"status":"submitted","minutes_ago":12},
    {"id":"DEMO-1036","citizen_id":"demo-community","citizen_name":"Kankarbhaag Colony","emergency_type":"evacuation","latitude":27.7027,"longitude":85.3188,"accuracy_m":22.0,"people_count":12,"notes":"Community group needs transport to a safe zone before the lower road becomes impassable.","risk_score":64,"risk_level":"high","precipitation_next_6h_mm":28.7,"river_discharge_m3s":145.3,"status":"assigned","responder_id":"demo-sita","responder_name":"Sita Thapa","minutes_ago":34},
    {"id":"DEMO-1033","citizen_id":"demo-gandhi","citizen_name":"Gandhi Maidan Area","emergency_type":"medical","latitude":27.7241,"longitude":85.3126,"accuracy_m":18.0,"people_count":3,"notes":"Three residents need assisted transport; one has limited mobility.","risk_score":52,"risk_level":"moderate","precipitation_next_6h_mm":19.4,"river_discharge_m3s":119.7,"status":"resolved","responder_id":"demo-ramesh","responder_name":"Ramesh K.","minutes_ago":68},
]


def seed_demo_emergencies(db: Session) -> None:
    existing_ids = set(db.scalars(select(Emergency.id).where(Emergency.is_demo.is_(True))).all())
    now = datetime.now(timezone.utc)
    changed = False
    for item in DEMO_INCIDENTS:
        if item["id"] in existing_ids:
            continue
        minutes_ago = int(item["minutes_ago"])
        data = {key: value for key, value in item.items() if key != "minutes_ago"}
        created_at = now - timedelta(minutes=minutes_ago)
        db.add(Emergency(**data, created_at=created_at, updated_at=created_at, is_demo=True))
        changed = True
    if changed:
        db.commit()


@router.post("", response_model=EmergencyRecord, status_code=201)
def create_emergency(payload: EmergencyCreate, reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)) -> EmergencyRecord:
    if reporter["role"] != "citizen":
        raise HTTPException(403, "Sign in as a citizen to submit an emergency request.")
    now = datetime.now(timezone.utc)
    data = payload.model_dump(mode="json")
    data["citizen_id"] = reporter["sub"]
    record = Emergency(**data, id=f"SOS-{uuid4().hex[:8].upper()}", status=EmergencyStatus.submitted.value, created_at=now, location_updated_at=now, is_demo=False)
    db.add(record)
    db.commit()
    db.refresh(record)
    return EmergencyRecord.model_validate(record)


@router.get("", response_model=list[EmergencyRecord])
def list_emergencies(
    status: EmergencyStatus | None = None,
    is_demo: bool | None = None,
    reporter: dict = Depends(signed_reporter),
    db: Session = Depends(get_db),
) -> list[EmergencyRecord]:
    query = select(Emergency)
    if reporter["role"] != "worker":
        query = query.where(Emergency.citizen_id == reporter["sub"])
    if status is not None:
        query = query.where(Emergency.status == status.value)
    if is_demo is not None:
        query = query.where(Emergency.is_demo.is_(is_demo))
    records = db.scalars(query.order_by(Emergency.created_at.desc())).all()
    return [EmergencyRecord.model_validate(record) for record in records]


@router.get("/{emergency_id}", response_model=EmergencyRecord)
def get_emergency(emergency_id: str, reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)) -> EmergencyRecord:
    record = accessible_emergency(db, emergency_id, reporter)
    return EmergencyRecord.model_validate(record)


@router.patch("/{emergency_id}/location", response_model=EmergencyRecord)
def update_emergency_location(
    emergency_id: str,
    payload: EmergencyLocationUpdate,
    reporter: dict = Depends(signed_reporter),
    db: Session = Depends(get_db),
) -> EmergencyRecord:
    record = accessible_emergency(db, emergency_id, reporter)
    if record.is_demo:
        raise HTTPException(status_code=409, detail="Demo incidents do not accept live GPS updates")
    if record.status in {EmergencyStatus.resolved.value, EmergencyStatus.cancelled.value}:
        raise HTTPException(status_code=409, detail="Closed emergency requests do not accept location updates")

    record.latitude = payload.latitude
    record.longitude = payload.longitude
    record.accuracy_m = payload.accuracy_m
    record.updated_at = datetime.now(timezone.utc)
    record.location_updated_at = record.updated_at
    db.commit()
    db.refresh(record)
    return EmergencyRecord.model_validate(record)


@router.patch("/{emergency_id}/navigation", response_model=EmergencyRecord)
def update_emergency_navigation(
    emergency_id: str,
    payload: EmergencyNavigationUpdate,
    reporter: dict = Depends(worker),
    db: Session = Depends(get_db),
) -> EmergencyRecord:
    record = db.get(Emergency, emergency_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Emergency request not found")
    if record.status in {EmergencyStatus.resolved.value, EmergencyStatus.cancelled.value}:
        raise HTTPException(status_code=409, detail="Closed emergency requests do not accept navigation updates")
    if record.responder_id is None:
        raise HTTPException(status_code=409, detail="Assign a responder before saving navigation")

    now = datetime.now(timezone.utc)
    previous_status = record.status
    previous_navigation = record.navigation_status
    record.responder_latitude = payload.responder_latitude
    record.responder_longitude = payload.responder_longitude
    record.recommended_route = payload.recommended_route
    record.responder_eta_seconds = payload.responder_eta_seconds
    record.responder_distance_m = payload.responder_distance_m
    record.eta_updated_at = now if payload.responder_eta_seconds is not None else record.eta_updated_at
    record.route_updated_at = now
    record.navigation_status = payload.navigation_status.value
    record.reroute_reason = payload.reroute_reason
    if payload.navigation_status in {NavigationStatus.en_route, NavigationStatus.approaching, NavigationStatus.on_scene}:
        record.status = EmergencyStatus.en_route.value
    elif payload.navigation_status == NavigationStatus.resolved:
        record.status = EmergencyStatus.resolved.value
    if payload.navigation_status in {NavigationStatus.en_route, NavigationStatus.resolved}:
        record_milestones(record, previous_status, now)
    if payload.navigation_status == NavigationStatus.on_scene and previous_navigation != "on_scene" and record.on_scene_at is None:
        record.on_scene_at = now
    record.updated_at = now
    db.commit()
    db.refresh(record)
    return EmergencyRecord.model_validate(record)


@router.patch("/{emergency_id}", response_model=EmergencyRecord)
def update_emergency(emergency_id: str, payload: EmergencyUpdate, reporter: dict = Depends(worker), db: Session = Depends(get_db)) -> EmergencyRecord:
    record = db.get(Emergency, emergency_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Emergency request not found")
    if record.status in {EmergencyStatus.resolved.value, EmergencyStatus.cancelled.value} and payload.status != EmergencyStatus.resolved:
        raise HTTPException(status_code=409, detail="Closed emergency requests cannot be changed")
    previous_status = record.status
    record.status = payload.status.value
    if payload.responder_id is not None:
        record.responder_id = payload.responder_id
    if payload.responder_name is not None:
        record.responder_name = payload.responder_name
    record.updated_at = datetime.now(timezone.utc)
    record_milestones(record, previous_status, record.updated_at)
    db.commit()
    db.refresh(record)
    return EmergencyRecord.model_validate(record)


def record_milestones(record: Emergency, previous_status: str, now: datetime) -> None:
    if previous_status == record.status:
        return
    column = {"assigned": "assigned_at", "en_route": "en_route_at", "resolved": "resolved_at"}.get(record.status)
    if column and getattr(record, column) is None:
        setattr(record, column, now)
    # Assignment is also an explicit acknowledgment; do not infer one from a GPS update.
    if record.status == "assigned" and record.acknowledged_at is None:
        record.acknowledged_at = now


@router.post("/{emergency_id}/acknowledge", response_model=EmergencyRecord)
def acknowledge_emergency(emergency_id: str, reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    if reporter["role"] != "worker":
        raise HTTPException(403, "Only responders can acknowledge incidents.")
    record = db.get(Emergency, emergency_id)
    if record is None:
        raise HTTPException(404, "Emergency request not found")
    if record.status in {"resolved", "cancelled"}:
        raise HTTPException(409, "This incident is closed.")
    if record.acknowledged_at is None:
        record.acknowledged_at = datetime.now(timezone.utc)
        record.updated_at = record.acknowledged_at
        db.commit()
        db.refresh(record)
    return EmergencyRecord.model_validate(record)


@router.post("/{emergency_id}/cancel", response_model=EmergencyRecord)
def cancel_emergency(emergency_id: str, reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)) -> EmergencyRecord:
    record = accessible_emergency(db, emergency_id, reporter)
    if record.status != EmergencyStatus.submitted.value:
        raise HTTPException(status_code=409, detail="This request can only be cancelled before a responder is assigned")
    record.status = EmergencyStatus.cancelled.value
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return EmergencyRecord.model_validate(record)
