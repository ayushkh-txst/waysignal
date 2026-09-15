"""Citizen map API contracts, upstream failures, and stored-record isolation."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("JWT_SECRET", "isolated-map-tests-not-for-production-0123456789")
os.environ.setdefault("DATABASE_URL", "sqlite://")

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1 import citizen_map, routing
from app.api.v1.emergencies import Emergency
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import create_app


def headers(subject="map-owner", role="citizen", expired=False):
    token = jwt.encode({"sub": subject, "role": role, "iat": datetime.now(timezone.utc),
                        "exp": datetime.now(timezone.utc) + timedelta(seconds=-5 if expired else 600)},
                       settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'map.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    app = create_app()
    def db():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = db
    async def label(lat, lon):
        return citizen_map.PlaceLabel(primary="Test road", secondary=f"{lat}, {lon}", source="ArcGIS reverse geocoding")
    async def facilities(lat, lon):
        return [{"id": "osm-node-42", "name": "Mapped school", "type": "school", "latitude": lat, "longitude": lon}]
    monkeypatch.setattr(citizen_map, "location_label", label)
    monkeypatch.setattr(citizen_map, "_nearby_destinations", facilities)
    # Avoid running startup against any real configured database.
    client = TestClient(app, raise_server_exceptions=True)
    yield client, sessions, engine
    client.close()
    engine.dispose()


@pytest.mark.parametrize("auth,status", [({}, 401), ({"Authorization": "Bearer forged"}, 401),
    (headers(role="worker"), 403), (headers(expired=True), 401)])
def test_map_requires_citizen_token(api, auth, status):
    client, _, _ = api
    assert client.get("/api/v1/citizen-map/places?latitude=29&longitude=-95", headers=auth).status_code == status
    assert client.get("/api/v1/citizen-map/incidents", headers=auth).status_code == status


@pytest.mark.parametrize("coordinates", ["latitude=91&longitude=0", "latitude=0&longitude=-181",
    "latitude=NaN&longitude=0", "latitude=0&longitude=inf", "latitude=wrong&longitude=0"])
def test_invalid_coordinates_never_reach_providers(api, coordinates):
    assert api[0].get(f"/api/v1/citizen-map/places?{coordinates}", headers=headers()).status_code == 422


def test_places_use_exact_coordinates_and_explicit_facility_provenance(api):
    result = api[0].get("/api/v1/citizen-map/places?latitude=0&longitude=0", headers=headers())
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    data = result.json()
    assert data["latitude"] == 0 and data["longitude"] == 0
    assert data["facilities_status"] == "available"
    assert data["facilities"][0]["shelter_verified"] is False
    assert data["location"]["secondary"] == "0.0, 0.0"


def test_provider_outage_keeps_coordinates_without_fake_facilities(api, monkeypatch):
    async def fails(*args):
        raise httpx.ReadTimeout("isolated provider failure")
    monkeypatch.setattr(citizen_map, "location_label", fails)
    monkeypatch.setattr(citizen_map, "_nearby_destinations", fails)
    data = api[0].get("/api/v1/citizen-map/places?latitude=27.7172&longitude=85.324", headers=headers()).json()
    assert data["facilities"] == [] and data["facilities_status"] == "unavailable"
    assert data["location"]["source"] == "coordinates"
    assert data["location"]["secondary"] == "27.71720, 85.32400"
    assert "Houston" not in str(data)


def test_empty_facility_lookup_is_not_an_outage(api, monkeypatch):
    async def empty(*args):
        return []
    monkeypatch.setattr(citizen_map, "_nearby_destinations", empty)
    data = api[0].get("/api/v1/citizen-map/places?latitude=29&longitude=-95", headers=headers()).json()
    assert data["facilities"] == [] and data["facilities_status"] == "available"


def test_only_own_active_stored_incidents_and_responder_are_returned(api):
    client, sessions, engine = api
    now = datetime.now(timezone.utc)
    with sessions() as db:
        for id, owner, demo, status in [("own", "map-owner", False, "assigned"),
                ("other", "another-citizen", False, "assigned"), ("demo", "map-owner", True, "assigned"),
                ("closed", "map-owner", False, "resolved"), ("cancelled", "map-owner", False, "cancelled")]:
            db.add(Emergency(id=id, citizen_id=owner, citizen_name=owner, emergency_type="rescue",
                latitude=29.7179, longitude=-95.402, people_count=1, notes="",
                status=status, is_demo=demo, created_at=now, responder_id="worker-test", responder_name="Assigned responder",
                responder_latitude=29.72, responder_longitude=-95.41,
                recommended_route={"geometry": [[29.72, -95.41], [29.7179, -95.402]]}))
        db.commit()
    engine.dispose()
    response = client.get("/api/v1/citizen-map/incidents?citizen_id=another-citizen", headers=headers())
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    records = response.json()
    assert [r["id"] for r in records] == ["own"]
    assert records[0]["responder_latitude"] == 29.72
    assert records[0]["created_at"].endswith("Z")
    assert client.get("/api/v1/citizen-map/incidents", headers=headers("no-incidents")).json() == []


def test_facility_lookup_preserves_zero_coordinates_filters_invalid_and_caches(monkeypatch):
    calls = []
    async def post(url, content):
        calls.append(content)
        return httpx.Response(200, request=httpx.Request("POST", url), json={"elements": [
            {"type": "node", "id": 1, "lat": 0, "lon": 0, "tags": {"name": "Equator clinic", "amenity": "clinic"}},
            {"type": "node", "id": 2, "lat": 91, "lon": 0, "tags": {"amenity": "school"}},
            {"type": "way", "id": 3, "center": {"lat": 0.001, "lon": 0.001}, "tags": {"amenity": "school"}},
        ]})
    routing._destination_cache.clear()
    monkeypatch.setattr(routing._http, "post", post)
    async def run():
        first = await routing._nearby_destinations(0, 0)
        second = await routing._nearby_destinations(0, 0)
        assert first == second
        assert [f["id"] for f in first] == ["osm-node-1", "osm-way-3"]
        assert first[0]["latitude"] == 0 and first[0]["longitude"] == 0
    asyncio.run(run())
    assert len(calls) == 1
    routing._destination_cache.clear()
