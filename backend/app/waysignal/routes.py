"""One route-assessment implementation for native UI, REST, and MCP."""
import math
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

from app.api.v1.routing import _osrm_routes
from app.core.config import settings
from app.waysignal.domain import (AssessmentInput, HazardPolicy, ReportSource, RouteProvider,
    ReviewedClosurePolicy, UnreviewedHazardPolicy, distance_to_route)


class GOneRouteProvider:
    async def candidates(self, request: AssessmentInput) -> list[dict]:
        destination = {"latitude": request.destination.latitude, "longitude": request.destination.longitude}
        return await _osrm_routes(request.origin.latitude, request.origin.longitude, destination)


def route_provider() -> RouteProvider:
    if settings.waysignal_demo_mode:
        from app.waysignal.scenario import DemoRouteProvider
        return DemoRouteProvider()
    return GOneRouteProvider()


class RouteAssessmentService:
    def __init__(self, provider: RouteProvider, reports: ReportSource,
                 policies: list[HazardPolicy] | None = None):
        self.provider, self.reports = provider, reports
        self.policies = policies if policies is not None else [ReviewedClosurePolicy(), UnreviewedHazardPolicy()]

    async def assess(self, request: AssessmentInput) -> dict:
        reports = self.reports.reports()
        try:
            raw = await self.provider.candidates(request)
        except (httpx.HTTPError, TimeoutError, ValueError, KeyError):
            raise HTTPException(502, "Route provider is unavailable. No route assessment was made.") from None
        candidates = []
        for item in raw[:3]:
            try:
                coords = item["geometry"]["coordinates"]
                if not 2 <= len(coords) <= 10000:
                    continue
                geometry = [[float(p[1]), float(p[0])] for p in coords]
                if any(not math.isfinite(v) for p in geometry for v in p):
                    continue
                if any(not (-90 <= lat <= 90 and -180 <= lon <= 180) for lat, lon in geometry):
                    continue
                distance, duration = float(item["distance"]), float(item["duration"])
                if not all(math.isfinite(v) and v >= 0 for v in (distance, duration)):
                    continue
            except (ValueError, TypeError, KeyError, IndexError):
                continue
            findings = []
            for report in reports:
                proximity = distance_to_route(report["latitude"], report["longitude"], geometry)
                for policy in self.policies:
                    outcome = policy.evaluate(report, proximity)
                    if outcome:
                        findings.append(outcome)
            excluded = any(f["disposition"] == "exclude" for f in findings)
            candidates.append({"id": f"route-{len(candidates)+1}", "geometry": geometry,
                "distance_m": distance, "duration_s": duration, "excluded": excluded,
                "findings": findings, "transport_mode": "driving"})
        if not candidates:
            raise HTTPException(502, "The provider returned no usable route geometry.")
        remaining = [c for c in candidates if not c["excluded"]]
        remaining.sort(key=lambda c: (len(c["findings"]), c["duration_s"]))
        return {"destination_name": request.destination_name, "generated_at": datetime.now(timezone.utc).isoformat(),
            "candidates": candidates, "selected_id": remaining[0]["id"] if remaining else None,
            "source": "Synthetic demo routes + demo community reviews" if settings.waysignal_demo_mode else "OSRM driving routes + WaySignal community reviews",
            "data_status": "demo" if settings.waysignal_demo_mode else "available",
            "notice": ("DEMO: schematic route geometry and simulated travel times; not road directions. " if settings.waysignal_demo_mode else "") +
                "Point-based report screening, not verified flood boundaries. Conditions outside reported locations remain unknown. Routes are not guaranteed safe."}
