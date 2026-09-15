"""Sourced emergency directory. Phone numbers never come from a language model."""
from __future__ import annotations

import time
import httpx

CHECKED_ON = "2026-09-13"
US_SOURCE = "https://www.911.gov/calling-911/frequently-asked-questions/"
NP_SOURCE = "https://travel.state.gov/en/international-travel/travel-advisories/nepal.html"
KTM_SOURCE = "https://kathmandu.gov.np/en/contact"
GEOCODE_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode"
_location_cache: dict[tuple[float, float], tuple[float, dict]] = {}


async def resolve_location(latitude: float, longitude: float) -> dict:
    # Exact coordinates prevent a cached country from crossing a border.
    key = (latitude, longitude)
    cached = _location_cache.get(key)
    if cached and time.monotonic() - cached[0] < 600:
        return dict(cached[1])
    async with httpx.AsyncClient(timeout=3.5) as client:
        response = await client.get(GEOCODE_URL, params={
            "location": f"{longitude},{latitude}", "f": "json", "langCode": "EN",
            "distance": 250, "outSR": 4326,
        })
        response.raise_for_status()
        address = response.json().get("address") or {}
        country = {"USA": "US", "US": "US", "NPL": "NP", "NP": "NP"}.get(address.get("CountryCode"))
        raw_country = str(address.get("CountryCode") or "")[:3]
        if not raw_country:
            raise ValueError("Country could not be resolved")
        result = {"label": str(address.get("LongLabel") or address.get("Match_addr") or
                                 address.get("ShortLabel") or f"{latitude:.5f}, {longitude:.5f}")[:400],
                  "country": country or raw_country, "city": str(address.get("City") or "")[:120],
                  "region": str(address.get("Region") or "")[:120], "source": "ArcGIS reverse geocoding"}
        if len(_location_cache) >= 500:
            _location_cache.pop(min(_location_cache, key=lambda item: _location_cache[item][0]))
        _location_cache[key] = (time.monotonic(), result)
        return dict(result)


def contact(id, name, phone, services, coverage, source_url, note, short_code=True, emergency=True):
    return dict(id=id, name=name, phone=phone, services=services, coverage=coverage,
                source_url=source_url, checked_on=CHECKED_ON, note=note,
                short_code=short_code, emergency=emergency)


def directory_for(location: dict, manual_country: str | None = None) -> dict:
    country = manual_country or location.get("country")
    contacts = []
    if country == "US":
        contacts.append(contact("us-911", "Emergency dispatch", "911", ["Ambulance / EMS", "Fire & rescue", "Police"],
            "United States", US_SOURCE,
            "One dispatch number for emergency services. Dialing uses the caller's area, not the incident's map pin."))
        if not manual_country and location.get("city", "").casefold() == "houston" and location.get("region", "").casefold() in {"texas", "tx"}:
            contacts.append(contact("houston-police", "Houston Police — non-emergency line", "+17138843131",
                ["Police coordination"], "Houston city limits only", "https://www.houstontx.gov/police/contact/",
                "Official non-emergency police line. Remote admins must confirm jurisdiction and explain where assistance is needed.", False, False))
    elif country == "NP":
        contacts.extend([
            contact("np-ambulance", "Ambulance / emergency medical services", "102", ["Ambulance / EMS"], "Nepal", NP_SOURCE,
                    "Coverage and response availability vary; confirm with the dispatcher."),
            contact("np-fire", "Fire brigade", "101", ["Fire & rescue"], "Nepal", NP_SOURCE,
                    "Confirm the local brigade and required rescue capability with dispatch."),
            contact("np-police", "Nepal Police control", "100", ["Police", "Rescue coordination"], "Nepal",
                    "https://nepalpolice.gov.np/stations/emergency-contacts/", "Request coordination for the reported incident location."),
        ])
        if not manual_country and location.get("city", "").casefold() in {"kathmandu", "kathmandu metropolitan city"}:
            contacts.append(contact("ktm-control", "Kathmandu Metropolitan Police control room", "+9779851356509",
                ["Police", "Rescue coordination"], "Kathmandu Metropolitan City", KTM_SOURCE,
                "Municipal control room; confirm the incident is inside its jurisdiction.", False))
    return {"country": country, "selection": "manually selected directory" if manual_country else
            "matched from incident GPS" if country else "location unresolved", "contacts": contacts,
            "notice": "Short codes connect according to the caller's location and phone network. For a remote incident, use a verified local coordination number and confirm jurisdiction. No service is contacted by this application.",
            "coverage_notice": "Listed contacts are published numbers, not a live availability feed. No dedicated rescue-team dispatch integration is connected."
                if contacts else "No verified directory is connected for this location. Confirm the jurisdiction using official local emergency-service sources."}
