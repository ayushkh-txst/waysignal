"""Transport-neutral route contracts and independently extensible hazard policies."""
from __future__ import annotations

import math
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class Coordinate(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class AssessmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Coordinate
    destination: Coordinate
    destination_name: str = Field(default="Selected destination", min_length=1, max_length=160)


class RouteProvider(Protocol):
    async def candidates(self, request: AssessmentInput) -> list[dict]: ...


class ReportSource(Protocol):
    def reports(self) -> list[dict]: ...


class HazardPolicy(Protocol):
    def evaluate(self, report: dict, distance_m: float) -> dict | None: ...


def distance_to_route(latitude: float, longitude: float, geometry: list[list[float]]) -> float:
    """Local tangent-plane distance to every segment, in metres; [lat, lon] input."""
    scale = math.pi * 6_371_000 / 180
    cosine = max(0.000001, math.cos(math.radians(latitude)))
    points = [((((lon - longitude + 180) % 360) - 180) * scale * cosine,
               (lat - latitude) * scale) for lat, lon in geometry]
    best = math.inf
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        denominator = dx * dx + dy * dy
        t = min(1.0, max(0.0, -(a[0] * dx + a[1] * dy) / denominator)) if denominator else 0.0
        best = min(best, math.hypot(a[0] + t * dx, a[1] + t * dy))
    return best


def finding(report: dict, distance_m: float, disposition: str) -> dict:
    return {"report_id": report["id"], "label": report["label"],
            "review_state": report["review_state"], "distance_m": round(distance_m, 1),
            "disposition": disposition, "updated_at": report["updated_at"],
            "reason": "Reported hazard is near this route; location accuracy is limited."}


def report_radius(report):
    """Use the same buffer for map circles and route-segment screening."""
    return max(120.0 if report['kind'] == 'flooded_road' else 60.0,
               min(report.get('accuracy_m') or 0, 250.0))


class ReportedHazardPolicy:
    """Physical obstacles block a route while review is pending, including debris."""
    def evaluate(self, report: dict, distance_m: float) -> dict | None:
        if report['status'] != 'active' or report['review_state'] in ('rejected', 'resolved'):
            return None
        if distance_m > report_radius(report):
            return None
        excludes = report['review_state'] == 'reviewed_active' or report['kind'] in ('flooded_road', 'road_blocked', 'debris')
        result = finding(report, distance_m, 'exclude' if excludes else 'review_needed')
        result['reason'] = ('Avoid this reported flood or obstruction; review may still be pending.' if excludes
                            else 'An unverified observation is near this route. Check its details.')
        return result
