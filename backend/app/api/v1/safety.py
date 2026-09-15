from __future__ import annotations

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
FLOOD_URL = "https://flood-api.open-meteo.com/v1/flood"


class SafetyContext(BaseModel):
    latitude: float
    longitude: float
    observed_at: str
    source: str
    temperature_c: float | None
    precipitation_next_6h_mm: float
    precipitation_probability_max_6h: float | None
    river_discharge_m3s: float | None
    river_discharge_tomorrow_m3s: float | None
    river_trend_percent: float | None
    prototype_risk_score: int
    prototype_risk_level: str


def _risk_score(*, rain_6h: float, rain_probability: float | None, discharge: float | None, trend: float | None) -> tuple[int, str]:
    # Hackathon prototype score: transparent heuristic based on live forecast inputs.
    # It is NOT an official flood warning or hydrological model.
    score = 10.0
    score += min(rain_6h / 60.0, 1.0) * 45.0
    if rain_probability is not None:
        score += min(max(rain_probability, 0.0), 100.0) / 100.0 * 15.0
    if trend is not None:
        score += min(max(trend, 0.0), 100.0) / 100.0 * 20.0
    if discharge is not None and discharge > 0:
        score += min(discharge / 500.0, 1.0) * 10.0

    final = max(0, min(100, round(score)))
    if final >= 80:
        level = "critical"
    elif final >= 60:
        level = "high"
    elif final >= 35:
        level = "moderate"
    else:
        level = "low"
    return final, level


@router.get("/context", response_model=SafetyContext)
async def get_safety_context(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
) -> SafetyContext:
    weather_params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m",
        "hourly": "precipitation,precipitation_probability",
        "forecast_hours": 6,
        "timezone": "auto",
    }
    flood_params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "river_discharge",
        "forecast_days": 2,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            weather_response, flood_response = await __import__("asyncio").gather(
                client.get(WEATHER_URL, params=weather_params),
                client.get(FLOOD_URL, params=flood_params),
            )
        weather_response.raise_for_status()
        flood_response.raise_for_status()
    except (httpx.HTTPError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="Live environmental data is temporarily unavailable") from exc

    weather = weather_response.json()
    flood = flood_response.json()

    precipitation = weather.get("hourly", {}).get("precipitation", [])[:6]
    precipitation_probability = weather.get("hourly", {}).get("precipitation_probability", [])[:6]
    rain_6h = round(sum(float(value or 0) for value in precipitation), 1)
    probability_values = [float(value) for value in precipitation_probability if value is not None]
    rain_probability = max(probability_values) if probability_values else None

    discharge_values = flood.get("daily", {}).get("river_discharge", [])
    discharge_today = float(discharge_values[0]) if discharge_values and discharge_values[0] is not None else None
    discharge_tomorrow = float(discharge_values[1]) if len(discharge_values) > 1 and discharge_values[1] is not None else None
    river_trend = None
    if discharge_today and discharge_tomorrow is not None:
        river_trend = round(((discharge_tomorrow - discharge_today) / discharge_today) * 100.0, 1)

    score, level = _risk_score(
        rain_6h=rain_6h,
        rain_probability=rain_probability,
        discharge=discharge_today,
        trend=river_trend,
    )

    current_temperature = weather.get("current", {}).get("temperature_2m")
    return SafetyContext(
        latitude=latitude,
        longitude=longitude,
        observed_at=datetime.now(timezone.utc).isoformat(),
        source="Open-Meteo forecast + GloFAS flood forecast",
        temperature_c=float(current_temperature) if current_temperature is not None else None,
        precipitation_next_6h_mm=rain_6h,
        precipitation_probability_max_6h=rain_probability,
        river_discharge_m3s=round(discharge_today, 2) if discharge_today is not None else None,
        river_discharge_tomorrow_m3s=round(discharge_tomorrow, 2) if discharge_tomorrow is not None else None,
        river_trend_percent=river_trend,
        prototype_risk_score=score,
        prototype_risk_level=level,
    )
