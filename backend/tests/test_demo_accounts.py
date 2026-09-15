"""Actual password logins, distinct citizens, and two coordinating admins."""
import os

os.environ.setdefault("JWT_SECRET", "multiuser-test-only-secret-0123456789")
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.router import api_router
from app.api.v1 import auth
from app.auth.repositories import InMemoryUserRepository
from app.auth.service import AuthService
from app.core.config import Settings
from app.core.database import Base, get_db


# Test fixtures only; deployed credentials are generated privately by Render.
ACCOUNTS = [
    ("citizen@example.com", "TestCitizenOne!26", "citizen-demo", "citizen", "demo_citizen_password"),
    ("citizen2@example.com", "TestCitizenTwo!26", "citizen-demo-2", "citizen", "demo_citizen_2_password"),
    ("citizen3@example.com", "TestCitizenThree!26", "citizen-demo-3", "citizen", "demo_citizen_3_password"),
    ("worker@example.com", "TestWorkerOne!26", "worker-demo", "worker", "demo_worker_password"),
    ("worker2@example.com", "TestWorkerTwo!26", "worker-demo-2", "worker", "demo_worker_2_password"),
]


def config(**changes):
    values = {row[4]: row[1] for row in ACCOUNTS}
    values.update(changes)
    return Settings(_env_file=None, jwt_secret="fixture-only", **values)


def test_unconfigured_extra_accounts_are_disabled():
    repo = InMemoryUserRepository(config(demo_citizen_2_password="", demo_citizen_3_password="", demo_worker_2_password=""))
    assert repo.get_by_email("citizen@example.com").id == "citizen-demo"
    assert repo.get_by_email("worker@example.com").id == "worker-demo"
    for email in ("citizen2@example.com", "citizen3@example.com", "worker2@example.com"):
        assert repo.get_by_email(email) is None


@pytest.mark.parametrize("password", ["short", " " * 12, "x" * 129])
def test_extra_passwords_must_be_usable(password):
    with pytest.raises(ValidationError):
        config(demo_worker_2_password=password)


def test_duplicate_emails_cannot_replace_another_identity():
    with pytest.raises(ValueError, match="distinct"):
        InMemoryUserRepository(config(demo_citizen_email=" WORKER2@example.com "))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "_auth", AuthService(InMemoryUserRepository(config())))
    engine = create_engine(f"sqlite:///{tmp_path / 'accounts.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")
    def db():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


def login(client, account):
    email, password, user_id, role, _ = account
    response = client.post("/api/v1/auth/login", json={"email": email.upper(), "password": password})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["id"] == user_id
    assert body["user"]["role"] == role
    assert "password" not in response.text
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "IncorrectPassword!"}).status_code == 401
    return {"Authorization": f"Bearer {body['access_token']}"}


def test_five_logins_isolate_citizens_and_allow_both_admins(client):
    headers = [login(client, account) for account in ACCOUNTS]
    assert len({h["Authorization"] for h in headers}) == 5
    # An extra account's password cannot sign in as the original admin.
    assert client.post("/api/v1/auth/login", json={"email": "worker@example.com", "password": ACCOUNTS[4][1]}).status_code == 401
    records = []
    for i in range(3):
        response = client.post("/api/v1/emergencies", headers=headers[i], json={
            "citizen_id": "spoofed", "citizen_name": f"Test Citizen {i + 1}",
            "emergency_type": "rescue", "latitude": 29.7, "longitude": -95.4,
            "notes": "Multi-account test request",
        })
        assert response.status_code == 201
        assert response.json()["citizen_id"] == ACCOUNTS[i][2]
        records.append(response.json()["id"])

    for i in range(3):
        assert [r["id"] for r in client.get("/api/v1/emergencies", headers=headers[i]).json()] == [records[i]]
        assert [r["id"] for r in client.get("/api/v1/citizen-map/incidents", headers=headers[i]).json()] == [records[i]]
        for other in (id for id in records if id != records[i]):
            path = f"/api/v1/emergencies/{other}"
            assert client.get(path, headers=headers[i]).status_code == 404
            assert client.patch(path + "/location", headers=headers[i], json={"latitude": 0, "longitude": 0}).status_code == 404
            assert client.post(path + "/cancel", headers=headers[i]).status_code == 404
        assert client.patch(f"/api/v1/emergencies/{records[i]}", headers=headers[i], json={"status": "assigned"}).status_code == 403
        for endpoint in ("/admin/reports", "/admin/dispatch/notifications"):
            assert client.get("/api/v1" + endpoint, headers=headers[i]).status_code == 403

    for admin in headers[3:]:
        assert {r["id"] for r in client.get("/api/v1/emergencies", headers=admin).json()} == set(records)
        assert client.get("/api/v1/admin/reports", headers=admin).json()["summary"]["total"] == 3
    feed = "/api/v1/admin/dispatch/notifications"
    item = client.get(feed, headers=headers[3]).json()["items"][0]
    assert client.post(f"/api/v1/admin/dispatch/incidents/{item['incident_id']}/review", headers=headers[3], json={"revision": item["revision"]}).status_code == 200
    assert client.get(feed, headers=headers[3]).json()["unread_count"] == 2
    assert client.get(feed, headers=headers[4]).json()["unread_count"] == 3

    # Both admins can assign; the other admin may coordinate without reassigning.
    for i in range(2):
        path = f"/api/v1/emergencies/{records[i]}"
        admin_index = i + 3
        assigned = client.patch(path, headers=headers[admin_index], json={
            "status": "assigned", "responder_id": ACCOUNTS[admin_index][2],
            "responder_name": f"Test Admin {i + 1}",
        })
        assert assigned.status_code == 200
        other_admin = headers[4 if i == 0 else 3]
        assert client.patch(path, headers=other_admin, json={"status": "en_route"}).status_code == 200
        assert client.get(path, headers=headers[i]).json()["status"] == "en_route"
        assert client.patch(path, headers=other_admin, json={"status": "resolved"}).status_code == 200
        result = client.get(path, headers=headers[i]).json()
        assert result["responder_id"] == ACCOUNTS[admin_index][2]
        assert result["resolved_at"]

    # Reconstructing the configured accounts preserves access to existing records.
    auth._auth = AuthService(InMemoryUserRepository(config()))
    again = login(client, ACCOUNTS[1])
    assert client.get(f"/api/v1/emergencies/{records[1]}", headers=again).status_code == 200
