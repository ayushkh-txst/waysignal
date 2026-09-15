"""Shared, unverified road reports. Identity comes from the signed login token."""

import base64
import binascii
import hashlib
import io
import warnings
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Float, LargeBinary, String, UniqueConstraint, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, defer, mapped_column

from app.core.config import settings
from app.core.database import Base, get_db

MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_BODY_BYTES = 12 * 1024 * 1024
LABELS = {"road_blocked": "Road blocked", "flooded_road": "Flooded road",
          "debris": "Debris / obstruction", "other": "Other hazard"}
Kind = Literal["road_blocked", "flooded_road", "debris", "other"]
Status = Literal["active", "resolved"]


class BoundedBodyRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded(request: Request):
            # Limit the actual stream, including requests without Content-Length.
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BODY_BYTES:
                    raise HTTPException(413, "Hazard request is too large.")
                body.extend(chunk)
            request._body = bytes(body)
            try:
                response = await handler(request)
                response.headers["Cache-Control"] = "no-store"
                return response
            except RequestValidationError:
                # Do not echo the uploaded base64 image or caller-supplied identity.
                return JSONResponse(status_code=422, content={"detail": "Invalid hazard data. Check the hazard type, GPS coordinates, submission ID, status, and photo."})

        return bounded


router = APIRouter(route_class=BoundedBodyRoute)
bearer = HTTPBearer(auto_error=False)


def signed_reporter(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    try:
        if credentials is None:
            raise ValueError()
        claims = jwt.decode(credentials.credentials, settings.jwt_secret,
                            algorithms=[settings.jwt_algorithm],
                            options={"require": ["sub", "role", "exp", "iat"]})
        if not isinstance(claims["sub"], str) or not claims["sub"] or len(claims["sub"]) > 128:
            raise ValueError()
        if claims["role"] not in ("citizen", "worker"):
            raise ValueError()
        return claims
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, "Sign in again to access hazard reports.",
                            headers={"WWW-Authenticate": "Bearer"}) from None


class Hazard(Base):
    __tablename__ = "hazard_reports"
    __table_args__ = (UniqueConstraint("reporter_id", "client_request_id"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    client_request_id: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(String(64))
    reporter_id: Mapped[str] = mapped_column(String(128), index=True)
    reporter_role: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(24), default="user_reported")
    kind: Mapped[str] = mapped_column(String(24))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    photo: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    photo_type: Mapped[str | None] = mapped_column(String(24), nullable=True)


class HazardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    client_request_id: UUID
    kind: Kind
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)
    photo_base64: str | None = Field(default=None, max_length=11_184_812)


class HazardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Status


class HazardRead(BaseModel):
    id: str
    kind: Kind
    label: str
    latitude: float
    longitude: float
    accuracy_m: float | None
    source: Literal["user_reported"]
    reporter_source: Literal["citizen", "worker"]
    status: Status
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    has_photo: bool


def utc(value: datetime | None):
    # SQLite returns naive timestamps; they were written in UTC, not local time.
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def public_report(row: Hazard) -> HazardRead:
    return HazardRead(id=row.id, kind=row.kind, label=LABELS[row.kind], latitude=row.latitude,
                      longitude=row.longitude, accuracy_m=row.accuracy_m, source=row.source,
                      reporter_source=row.reporter_role, status=row.status,
                      created_at=utc(row.created_at), updated_at=utc(row.updated_at),
                      resolved_at=utc(row.resolved_at), has_photo=row.photo_type is not None)


def validated_photo(encoded: str | None) -> bytes | None:
    if encoded is None:
        return None
    try:
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "Photo must be 8 MB or smaller.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 20_000_000:
                    raise ValueError()
                image.load()
                normalized = ImageOps.exif_transpose(image).convert("RGB")
                normalized.thumbnail((1600, 1600))
                # New image discards EXIF/GPS, comments, profiles, and animation.
                clean = Image.new("RGB", normalized.size)
                clean.paste(normalized)
                output = io.BytesIO()
                clean.save(output, format="JPEG", quality=85)
                return output.getvalue()
    except (ValueError, binascii.Error, OSError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Use a valid JPEG, PNG, or WebP photo up to 20 megapixels.") from None


@router.get("", response_model=list[HazardRead])
def list_hazards(status: Literal["active", "resolved", "all"] = "active",
                 reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    query = select(Hazard).options(defer(Hazard.photo)).order_by(Hazard.id)
    if status != "all":
        query = query.where(Hazard.status == status)
    rows = db.scalars(query.limit(2501)).all()
    if len(rows) > 2500:
        # Never return a silently truncated hazard screen.
        raise HTTPException(503, "Hazard feed exceeds prototype capacity; screening is unavailable.")
    return [public_report(row) for row in rows]


@router.post("", response_model=HazardRead, status_code=201)
def create_hazard(payload: HazardCreate, reporter: dict = Depends(signed_reporter),
                  db: Session = Depends(get_db)):
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    existing_query = select(Hazard).where(Hazard.reporter_id == reporter["sub"],
                                          Hazard.client_request_id == str(payload.client_request_id))

    def existing_result(existing):
        if existing.request_hash != digest:
            raise HTTPException(409, "This submission ID was already used for a different report.")
        return public_report(existing)

    existing = db.scalar(existing_query)
    if existing:
        return existing_result(existing)
    now = datetime.now(timezone.utc)
    count = db.scalar(select(func.count()).select_from(Hazard).where(
        Hazard.reporter_id == reporter["sub"], Hazard.created_at >= now - timedelta(minutes=1)))
    if count >= 10:
        raise HTTPException(429, "Too many reports. Wait a minute before submitting again.")
    photo = validated_photo(payload.photo_base64)
    row = Hazard(id=f"HAZ-{uuid4()}", client_request_id=str(payload.client_request_id),
                 request_hash=digest, reporter_id=reporter["sub"], reporter_role=reporter["role"],
                 kind=payload.kind, latitude=payload.latitude, longitude=payload.longitude,
                 accuracy_m=payload.accuracy_m, created_at=now, updated_at=now,
                 photo=photo, photo_type="image/jpeg" if photo else None)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(existing_query)
        if existing:
            return existing_result(existing)
        raise HTTPException(409, "Report could not be saved; retry the submission.") from None
    return public_report(row)


@router.patch("/{hazard_id}", response_model=HazardRead)
def update_hazard(hazard_id: str, payload: HazardUpdate, reporter: dict = Depends(signed_reporter),
                  db: Session = Depends(get_db)):
    if reporter["role"] != "worker":
        raise HTTPException(403, "Only a responder can resolve or reopen reports.")
    row = db.get(Hazard, hazard_id)
    if row is None:
        raise HTTPException(404, "Hazard report not found.")
    if row.status != payload.status:
        row.status = payload.status
        row.updated_at = datetime.now(timezone.utc)
        row.resolved_at = row.updated_at if row.status == "resolved" else None
        row.resolved_by = reporter["sub"] if row.status == "resolved" else None
        db.commit()
    return public_report(row)


@router.get("/{hazard_id}/photo")
def get_photo(hazard_id: str, reporter: dict = Depends(signed_reporter), db: Session = Depends(get_db)):
    row = db.get(Hazard, hazard_id)
    if row is None:
        raise HTTPException(404, "Hazard report not found.")
    if reporter["role"] != "worker" and reporter["sub"] != row.reporter_id:
        raise HTTPException(403, "Only the reporter and responders can view this photo.")
    if row.photo is None:
        raise HTTPException(404, "This report has no photo.")
    return {"data_url": "data:image/jpeg;base64," + base64.b64encode(row.photo).decode()}
