"""Run: python -m pytest tests/test_hazards.py (uses only temporary SQLite)."""
import base64
import io
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "isolated-test-secret-not-for-deployment-0123456789"

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.hazards import Hazard, MAX_BODY_BYTES, router
from app.core.config import settings
from app.core.database import Base, get_db


def headers(subject="citizen-test", role="citizen", expired=False):
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": subject, "role": role, "iat": now,
                        "exp": now + timedelta(seconds=-1 if expired else 600)},
                       settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'hazards.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    app = FastAPI()
    app.include_router(router, prefix="/hazards")

    def db():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db
    with TestClient(app) as client:
        yield client, engine, sessions
    engine.dispose()


def payload(**overrides):
    return {"client_request_id": str(uuid4()), "kind": "road_blocked",
            "latitude": 29.71799, "longitude": -95.402, "accuracy_m": 35, **overrides}


def test_shared_across_sessions_resolve_reopen_and_restart(api):
    client, engine, sessions = api
    saved = client.post("/hazards", json=payload(), headers=headers())
    assert saved.status_code == 201
    report = saved.json()
    assert report["status"] == "active" and report["source"] == "user_reported"
    assert report["created_at"].endswith("Z")
    assert "reporter_id" not in report
    worker = headers("worker-test", "worker")
    assert client.get("/hazards", headers=worker).json() == [report]
    path = f"/hazards/{report['id']}"
    assert client.patch(path, json={"status": "resolved"}, headers=headers()).status_code == 403
    resolved = client.patch(path, json={"status": "resolved"}, headers=worker)
    assert resolved.status_code == 200 and resolved.json()["resolved_at"]
    assert client.get("/hazards", headers=headers()).json() == []
    assert len(client.get("/hazards?status=resolved", headers=headers()).json()) == 1
    assert len(client.get("/hazards?status=all", headers=worker).json()) == 1
    client.patch(path, json={"status": "active"}, headers=worker)
    # Dispose/reopen connections: data is not held in a module dictionary or browser.
    engine.dispose()
    assert client.get("/hazards", headers=headers("another-citizen")).json()[0]["id"] == report["id"]
    with sessions() as db:
        row = db.scalar(select(Hazard))
        assert row.reporter_id == "citizen-test" and row.resolved_by is None


@pytest.mark.parametrize("bad_headers", [{}, {"Authorization": "Bearer forged"},
    headers(expired=True), headers(role="admin"), headers(role="worker") | {"Authorization": "Bearer none"}])
def test_authentication_required(api, bad_headers):
    client, _, _ = api
    assert client.get("/hazards", headers=bad_headers).status_code == 401
    assert client.post("/hazards", json=payload(), headers=bad_headers).status_code == 401


@pytest.mark.parametrize("invalid", [{"latitude": 91}, {"longitude": -181}, {"accuracy_m": -1},
    {"latitude": "NaN"}, {"kind": "invented"}, {"reporter_id": "someone-else"},
    {"status": "resolved"}, {"created_at": "2020-01-01"}, {"photo_base64": "not base64"},
    {"photo_base64": base64.b64encode(b'<svg onload="alert(1)"></svg>').decode()}])
def test_input_validation(api, invalid):
    client, _, _ = api
    assert client.post("/hazards", json=payload(**invalid), headers=headers()).status_code == 422
    assert client.get("/hazards", headers=headers()).json() == []


def test_upload_is_sanitized_persisted_and_protected(api):
    client, engine, _ = api
    image = Image.new("RGB", (1800, 1000), "red")
    exif = Image.Exif()
    exif[270] = "private metadata"
    stream = io.BytesIO()
    image.save(stream, format="JPEG", exif=exif)
    saved = client.post("/hazards", json=payload(photo_base64=base64.b64encode(stream.getvalue()).decode()), headers=headers())
    assert saved.status_code == 201 and saved.json()["has_photo"]
    path = f"/hazards/{saved.json()['id']}/photo"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=headers("other-citizen")).status_code == 403
    engine.dispose()
    result = client.get(path, headers=headers("worker-test", "worker"))
    assert result.status_code == 200
    photo = Image.open(io.BytesIO(base64.b64decode(result.json()["data_url"].split(",")[1])))
    assert photo.format == "JPEG" and max(photo.size) <= 1600 and not photo.getexif()
    assert client.get(path, headers=headers()).status_code == 200


def test_retry_idempotency_and_rate_limit(api):
    client, _, _ = api
    body = payload()
    first = client.post("/hazards", json=body, headers=headers()).json()
    second = client.post("/hazards", json=body, headers=headers()).json()
    assert first["id"] == second["id"]
    assert client.post("/hazards", json={**body, "kind": "debris"}, headers=headers()).status_code == 409
    for _ in range(9):
        assert client.post("/hazards", json=payload(), headers=headers()).status_code == 201
    assert client.post("/hazards", json=payload(), headers=headers()).status_code == 429
    assert client.post("/hazards", json=body, headers=headers()).status_code == 201


def test_missing_invalid_status_and_body_limit(api):
    client, _, _ = api
    worker = headers("worker-test", "worker")
    assert client.patch("/hazards/missing", json={"status": "resolved"}, headers=worker).status_code == 404
    assert client.patch("/hazards/missing", json={"status": "fake"}, headers=worker).status_code == 422
    assert client.get("/hazards?status=fake", headers=worker).status_code == 422
    response = client.post("/hazards", content=b"x" * (MAX_BODY_BYTES + 1), headers=headers())
    assert response.status_code == 413


def test_real_app_startup_and_separate_process_restart(tmp_path):
    script = '''
import sys
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import create_access_token
with TestClient(app) as client:
    token, _ = create_access_token(subject="restart-test", role="citizen")
    headers = {"Authorization": "Bearer " + token}
    if sys.argv[1] == "create":
        result = client.post("/api/v1/hazards", headers=headers, json={
            "client_request_id": "456977c3-7cce-43c4-b969-830611cb9c20",
            "kind": "flooded_road", "latitude": 29.7, "longitude": -95.4})
        assert result.status_code == 201, result.text
    reports = client.get("/api/v1/hazards", headers=headers)
    assert reports.status_code == 200 and len(reports.json()) == 1, reports.text
'''
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{tmp_path / 'restart.db'}"}
    for mode in ("create", "read-after-restart"):
        result = subprocess.run([sys.executable, "-c", script, mode], env=env,
                                capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, result.stderr
