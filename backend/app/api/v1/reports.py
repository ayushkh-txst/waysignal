"""Worker-only operational reports, calculated exclusively from persisted SOS records.

Seeded demo incidents are excluded. Risk is the stored prototype score, not an
official hazard classification. Unknown historical measurements remain null.
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.emergencies import Emergency, EmergencyStatus, EmergencyType
from app.api.v1.hazards import signed_reporter
from app.core.database import get_db

router = APIRouter()
BANDS = ["critical", "high", "moderate", "low", "unknown"]
ACTIVE = {"submitted", "assigned", "en_route"}


def worker(reporter: dict = Depends(signed_reporter)):
    if reporter["role"] != "worker":
        raise HTTPException(403, "Reports are available to responders only.")
    return reporter


def utc(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def band(row: Emergency) -> str:
    if row.risk_score is None:
        return "unknown"
    return "critical" if row.risk_score >= 80 else "high" if row.risk_score >= 60 else "moderate" if row.risk_score >= 35 else "low"


def gps_group(latitude: float, longitude: float) -> str:
    # A GPS group, explicitly NOT an inferred district or county boundary.
    return ", ".join(f"{value:.3f}".replace("-0.000", "0.000") for value in (latitude, longitude))


def location_key(row: Emergency) -> str:
    return gps_group(row.latitude, row.longitude)


def normalize_location(value: str | None) -> str | None:
    if not value or not value.strip():
        return None
    decimal = r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)"
    match = re.fullmatch(rf"\s*({decimal})\s*,\s*({decimal})\s*", value)
    if not match:
        raise HTTPException(422, "Enter GPS as latitude, longitude, for example 29.718, -95.402.")
    latitude, longitude = (float(part) for part in match.groups())
    if not -90 <= latitude <= 90:
        raise HTTPException(422, "Latitude must be between -90 and 90.")
    if not -180 <= longitude <= 180:
        raise HTTPException(422, "Longitude must be between -180 and 180.")
    return gps_group(latitude, longitude)


def duration(row: Emergency, field: str, now: datetime) -> float | None:
    start, end = utc(row.created_at), utc(getattr(row, field))
    return (end - start).total_seconds() if start and end and start <= end <= now else None


def measurement(rows: list[Emergency], field: str, now: datetime) -> dict:
    values = [value for row in rows if (value := duration(row, field, now)) is not None]
    return {"seconds": round(sum(values) / len(values), 1) if values else None, "samples": len(values)}


def report_filters(
    start_date: date | None = None, end_date: date | None = None,
    timezone_name: str = Query("UTC", max_length=80),
    severity: Literal["critical", "high", "moderate", "low", "unknown"] | None = None,
    incident_type: EmergencyType | None = None, status: EmergencyStatus | None = None,
    location: str | None = Query(None, max_length=64), page: int = Query(1, ge=1),
):
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Choose a valid IANA time zone.") from None
    today = datetime.now(zone).date()
    end = end_date or today
    start = start_date or end - timedelta(days=6)
    if start > end or (end - start).days > 92:
        raise HTTPException(422, "Choose a date range of 1 to 93 days.")
    if end > today:
        raise HTTPException(422, "The report end date cannot be in the future.")
    return {"start_date": start, "end_date": end, "zone": zone, "timezone_name": timezone_name,
            "severity": severity, "incident_type": incident_type, "status": status,
            "location": normalize_location(location), "page": page}


def build_report(db: Session, filters: dict, now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    zone = filters["zone"]
    start = datetime.combine(filters["start_date"], time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(filters["end_date"] + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    rows = list(db.scalars(select(Emergency).where(
        Emergency.is_demo.is_(False), Emergency.created_at >= start,
        Emergency.created_at < end, Emergency.created_at <= now,
    ).order_by(Emergency.created_at.desc(), Emergency.id)))
    locations = sorted({location_key(row) for row in rows})
    rows = [row for row in rows
            if (not filters["severity"] or band(row) == filters["severity"])
            and (not filters["incident_type"] or row.emergency_type == filters["incident_type"])
            and (not filters["status"] or row.status == filters["status"])
            and (not filters["location"] or location_key(row) == filters["location"])]
    total = len(rows)
    active = [row for row in rows if row.status in ACTIVE]
    resolved = [row for row in rows if row.status == "resolved"]
    severities = Counter(band(row) for row in rows)
    timings = {key: measurement(rows, field, now) for key, field in {
        "acknowledgment": "acknowledged_at", "assignment": "assigned_at",
        "dispatch": "en_route_at", "arrival": "on_scene_at", "resolution": "resolved_at",
    }.items()}
    trends = {}
    day = filters["start_date"]
    while day <= filters["end_date"]:
        trends[day.isoformat()] = {"date": day.isoformat(), "total": 0, **dict.fromkeys(BANDS, 0)}
        day += timedelta(days=1)
    groups = defaultdict(list)
    for row in rows:
        key = utc(row.created_at).astimezone(zone).date().isoformat()
        trends[key]["total"] += 1
        trends[key][band(row)] += 1
        groups[location_key(row)].append(row)
    areas = []
    for key, items in sorted(groups.items()):
        scores = [row.risk_score for row in items if row.risk_score is not None]
        areas.append({"location": key, "incidents": len(items),
                      "active_people": sum(row.people_count for row in items if row.status in ACTIVE),
                      "resolved": sum(row.status == "resolved" for row in items),
                      "max_risk_score": max(scores) if scores else None,
                      "assignment": measurement(items, "assigned_at", now), "safe_zone_load": None})
    quality = Counter(dict.fromkeys(["high", "medium", "low", "stale", "unknown"], 0))
    for row in active:
        updated = utc(row.location_updated_at)
        if updated is None or updated > now:
            quality["unknown"] += 1
        elif (now - updated).total_seconds() > 300:
            quality["stale"] += 1
        elif row.accuracy_m is None:
            quality["unknown"] += 1
        else:
            quality["high" if row.accuracy_m <= 25 else "medium" if row.accuracy_m <= 100 else "low"] += 1
    accuracies = [row.accuracy_m for row in active if row.accuracy_m is not None]
    serialized = [{"id": row.id, "incident_type": row.emergency_type, "status": row.status,
                   "people_count": row.people_count, "severity": band(row), "risk_score": row.risk_score,
                   "location": location_key(row), "created_at": utc(row.created_at).isoformat(),
                   "acknowledged_at": utc(row.acknowledged_at).isoformat() if row.acknowledged_at else None,
                   "assigned_at": utc(row.assigned_at).isoformat() if row.assigned_at else None,
                   "resolved_at": utc(row.resolved_at).isoformat() if row.resolved_at else None,
                   "location_updated_at": utc(row.location_updated_at).isoformat() if row.location_updated_at else None,
                   "accuracy_m": row.accuracy_m,
                   "assignment_seconds": duration(row, "assigned_at", now),
                   "resolution_seconds": duration(row, "resolved_at", now)} for row in rows]
    evacuation = [row for row in rows if row.emergency_type == "evacuation"]
    page_count = max(1, (total + 24) // 25)
    page = min(filters["page"], page_count)
    return {
        "generated_at": now.isoformat(), "source": "persisted_incidents", "demo_excluded": True,
        "filters": {key: value.isoformat() if isinstance(value, date) else value for key, value in filters.items() if key != "zone"},
        "locations": locations,
        "summary": {"total": total, "critical": severities["critical"], "active": len(active),
                    "resolved": len(resolved), "cancelled": sum(row.status == "cancelled" for row in rows),
                    "resolution_percent": round(100 * len(resolved) / total, 1) if total else None,
                    "people_in_resolved": sum(row.people_count for row in resolved),
                    "people_in_active": sum(row.people_count for row in active)},
        "timings": timings, "trend": list(trends.values()),
        "severity": [{"key": key, "count": severities[key]} for key in BANDS],
        "incident_types": [{"key": kind.value, "count": sum(row.emergency_type == kind.value for row in rows)} for kind in EmergencyType],
        "statuses": [{"key": status.value, "count": sum(row.status == status.value for row in rows)} for status in EmergencyStatus],
        "locations_summary": areas,
        "location_quality": {"total": len(active), "counts": dict(quality),
                             "average_accuracy_m": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
                             "accuracy_samples": len(accuracies), "stale_after_seconds": 300},
        "evacuation": {"incidents": len(evacuation), "people": sum(row.people_count for row in evacuation),
                       "resolved": sum(row.status == "resolved" for row in evacuation),
                       "active_people": sum(row.people_count for row in evacuation if row.status in ACTIVE)},
        "unavailable": {"district_boundaries": "District membership is not stored. Locations are grouped by GPS rounded to 3 decimals, not administrative boundaries.",
                        "safe_zone_load": "Shelter capacity and check-in data are not connected.",
                        "alert_delivery": "No persisted alert delivery or receipt records are available.",
                        "offline_sync": "Offline capture and synchronization events are not recorded.",
                        "assisted_people": "Resolved incident people counts are self-reported group sizes, not verified rescue totals."},
        "page": page, "page_count": page_count, "rows": serialized[(page - 1) * 25:page * 25],
    }, serialized


@router.get("")
def get_report(response: Response, filters: dict = Depends(report_filters),
               _: dict = Depends(worker), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return build_report(db, filters)[0]


def safe_cell(value):
    # Protect exported spreadsheets from formula interpretation of text fields.
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value if value is not None else ""


@router.get("/export")
def export_report(filters: dict = Depends(report_filters), _: dict = Depends(worker), db: Session = Depends(get_db)):
    report, rows = build_report(db, filters)
    fields = ["id", "incident_type", "status", "people_count", "severity", "risk_score", "location",
              "created_at", "acknowledged_at", "assigned_at", "resolved_at", "location_updated_at",
              "accuracy_m", "assignment_seconds", "resolution_seconds"]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["JalRakshak operational incidents", "Demo excluded", "Risk scores are prototype estimates"])
    writer.writerow(["Generated UTC", report["generated_at"], "Start date", filters["start_date"], "End date", filters["end_date"], "Time zone", filters["timezone_name"]])
    writer.writerow(["Filters", *(f"{key}={filters[key] or 'all'}" for key in ("severity", "incident_type", "status", "location"))])
    writer.writerow(fields)
    writer.writerows([[safe_cell(row[field]) for field in fields] for row in rows])
    filename = f"jalrakshak-reports-{filters['start_date']}-{filters['end_date']}.csv"
    return StreamingResponse(iter(["\ufeff" + output.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})
