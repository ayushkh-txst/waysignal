"""Transport-neutral route contracts and independently extensible hazard policies."""
from __future__ import annotations

import math
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class Coordinate(BaseModel):
    # Rejects NaN/inf and unknown fields so bad GPS input fails validation instead of breaking the math.
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class AssessmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: Coordinate
    destination: Coordinate
    destination_name: str = Field(default="Selected destination", min_length=1, max_length=160)


# Protocols let routing, report storage, and hazard rules be swapped independently.
class RouteProvider(Protocol):
    """Produces candidate routes between two points."""
    async def candidates(self, request: AssessmentInput) -> list[dict]: ...


class ReportSource(Protocol):
    """Supplies the current hazard reports to screen routes against."""
    def reports(self) -> list[dict]: ...


class HazardPolicy(Protocol):
    """Decides whether a report near a route matters; returns a finding or None."""
    def evaluate(self, report: dict, distance_m: float) -> dict | None: ...


def distance_to_route(latitude: float, longitude: float, geometry: list[list[float]]) -> float:
    """Local tangent-plane distance to every segment, in metres; [lat, lon] input."""
    # Project to a flat x/y plane (metres) centred on the hazard. Accurate at city scale,
    # far cheaper than great-circle math per segment. Longitude is shrunk by cos(lat)
    # and wrapped into [-180, 180) to handle the antimeridian.
    scale = math.pi * 6_371_000 / 180
    cosine = max(0.000001, math.cos(math.radians(latitude)))
    points = [((((lon - longitude + 180) % 360) - 180) * scale * cosine,
               (lat - latitude) * scale) for lat, lon in geometry]
    best = math.inf
    # For each segment, clamp the projection parameter t to [0, 1] to get the closest point
    # on the segment itself, then keep the minimum distance to the origin (the hazard).
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        denominator = dx * dx + dy * dy
        t = min(1.0, max(0.0, -(a[0] * dx + a[1] * dy) / denominator)) if denominator else 0.0
        best = min(best, math.hypot(a[0] + t * dx, a[1] + t * dy))
    return best


def finding(report: dict, distance_m: float, disposition: str) -> dict:
    """Build the API-facing record for one hazard near a route."""
    return {"report_id": report["id"], "label": report["label"],
            "review_state": report["review_state"], "distance_m": round(distance_m, 1),
            "disposition": disposition, "updated_at": report["updated_at"],
            "reason": "Reported hazard is near this route; location accuracy is limited."}


def report_radius(report):
    """Use the same buffer for map circles and route-segment screening."""
    # Floods get a wider minimum buffer (120 m vs 60 m); poor GPS accuracy widens it further, capped at 250 m.
    return max(120.0 if report['kind'] == 'flooded_road' else 60.0,
               min(report.get('accuracy_m') or 0, 250.0))


class ReportedHazardPolicy:
    """Physical obstacles block a route while review is pending, including debris."""
    def evaluate(self, report: dict, distance_m: float) -> dict | None:
        # Ignore closed-out reports and ones outside their buffer.
        if report['status'] != 'active' or report['review_state'] in ('rejected', 'resolved'):
            return None
        if distance_m > report_radius(report):
            return None
        # Physical blockages exclude the route immediately (safety first); other kinds only
        # exclude once reviewed, otherwise they are flagged for the user to check.
        excludes = report['review_state'] == 'reviewed_active' or report['kind'] in ('flooded_road', 'road_blocked', 'debris')
        result = finding(report, distance_m, 'exclude' if excludes else 'review_needed')
        result['reason'] = ('Avoid this reported flood or obstruction; review may still be pending.' if excludes
                            else 'An unverified observation is near this route. Check its details.')
        return result
