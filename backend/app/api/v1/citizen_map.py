"""Authenticated citizen map data. No demo locations or other citizens' SOS records."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.emergencies import Emergency, EmergencyRecord
from app.api.v1.hazards import signed_reporter
from app.api.v1.routing import _nearby_destinations
from app.core.database import get_db

router = APIRouter()
GEOCODE_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode"


def citizen(reporter: dict = Depends(signed_reporter)) -> dict:
    if reporter["role"] != "citizen":
        raise HTTPException(403, "This map endpoint is for citizens")
    return reporter


class PlaceLabel(BaseModel):
    primary: str
    secondary: str
    source: Literal["ArcGIS reverse geocoding", "coordinates"]


class Facility(BaseModel):
    id: str
    name: str
    kind: str
    latitude: float
    longitude: float
    # OSM amenities are candidate destinations, not verified evacuation shelters.
    shelter_verified: bool = False


class MapPlaces(BaseModel):
    latitude: float
    longitude: float
    retrieved_at: datetime
    location: PlaceLabel
    facilities: list[Facility]
    facilities_status: Literal["available", "unavailable"]
    facilities_source: str = "OpenStreetMap / Overpass"
    radius_m: int = 3500
    notice: str


async def location_label(latitude: float, longitude: float) -> PlaceLabel:
    async with httpx.AsyncClient(timeout=3.0) as client:
        result = await client.get(GEOCODE_URL, params={
            "location": f"{longitude},{latitude}", "f": "json", "langCode": "EN",
            "distance": 250, "outSR": 4326,
        })
        result.raise_for_status()
        address = result.json().get("address") or {}
        primary = address.get("ShortLabel") or address.get("Address") or address.get("Match_addr")
        if not isinstance(primary, str) or not primary.strip():
            raise ValueError("Location name unavailable")
        parts = [address.get(k) for k in ("Neighborhood", "City", "Subregion", "Region")]
        parts = list(dict.fromkeys(p for p in parts if isinstance(p, str) and p.strip()))
        return PlaceLabel(primary=primary[:200], secondary=" · ".join(parts[:3])[:400],
                          source="ArcGIS reverse geocoding")


@router.get("/places", response_model=MapPlaces)
async def places(response: Response,
                 latitude: float = Query(..., ge=-90, le=90, allow_inf_nan=False),
                 longitude: float = Query(..., ge=-180, le=180, allow_inf_nan=False),
                 _: dict = Depends(citizen)) -> MapPlaces:
    response.headers["Cache-Control"] = "no-store"
    location, destinations = await asyncio.gather(
        location_label(latitude, longitude),
        _nearby_destinations(latitude, longitude), return_exceptions=True,
    )
    if isinstance(location, Exception):
        location = PlaceLabel(primary="Selected map location",
                              secondary=f"{latitude:.5f}, {longitude:.5f}", source="coordinates")
    unavailable = isinstance(destinations, Exception)
    facilities = [] if unavailable else [Facility(
        id=item["id"], name=item["name"], kind=item["type"],
        latitude=item["latitude"], longitude=item["longitude"],
    ) for item in destinations]
    return MapPlaces(latitude=latitude, longitude=longitude,
                     retrieved_at=datetime.now(timezone.utc), location=location,
                     facilities=facilities, facilities_status="unavailable" if unavailable else "available",
                     notice="Nearby facilities could not be loaded. Retry the lookup." if unavailable else
                     "Mapped facilities are not confirmed open shelters. Capacity and flood clearance are unknown.")


@router.get("/incidents", response_model=list[EmergencyRecord])
def my_incidents(response: Response, reporter: dict = Depends(citizen),
                 db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    # Identity comes only from the signed token. Never accept a citizen_id query filter.
    rows = db.scalars(select(Emergency).where(
        Emergency.citizen_id == reporter["sub"], Emergency.is_demo.is_(False),
        Emergency.status.in_(["submitted", "assigned", "en_route"]),
    ).order_by(Emergency.created_at.desc())).all()
    return [EmergencyRecord.model_validate(row) for row in rows]
