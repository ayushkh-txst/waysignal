"""Public deployment boundaries: signed SOS access, SPA routes, provider DB URLs."""
import os

os.environ.setdefault("JWT_SECRET", "deployment-test-only-secret-0123456789")
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.emergencies import router
from app.core.config import Settings
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.web import mount_frontend


def auth(subject="citizen-one", role="citizen"):
    token, _ = create_access_token(subject=subject, role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'access.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    app = FastAPI()
    app.include_router(router, prefix="/emergencies")
    def db():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as client:
        yield client
    engine.dispose()


def submit(client, subject="citizen-one"):
    result = client.post("/emergencies", headers=auth(subject), json={
        "citizen_id": "spoofed-identity", "citizen_name": "Test citizen",
        "emergency_type": "rescue", "latitude": 29.7, "longitude": -95.4,
    })
    assert result.status_code == 201
    assert result.json()["citizen_id"] == subject
    return result.json()["id"]


@pytest.mark.parametrize("method,path,body", [
    ("get", "", None), ("get", "/unknown", None),
    ("post", "", {"citizen_id":"one","citizen_name":"Test","emergency_type":"rescue","latitude":29,"longitude":-95}),
    ("patch", "/unknown", {"status":"assigned"}),
    ("patch", "/unknown/location", {"latitude":29,"longitude":-95}),
    ("patch", "/unknown/navigation", {"responder_latitude":29,"responder_longitude":-95,"navigation_status":"en_route"}),
    ("post", "/unknown/cancel", None), ("post", "/unknown/acknowledge", None),
])
def test_emergency_routes_require_login(client, method, path, body):
    response = client.request(method, "/emergencies" + path, json=body)
    assert response.status_code == 401


def test_citizen_ownership_and_worker_lifecycle(client):
    one = submit(client)
    two = submit(client, "citizen-two")
    path = f"/emergencies/{one}"
    other = auth("citizen-two")
    assert [row["id"] for row in client.get("/emergencies", headers=other).json()] == [two]
    assert client.get(path, headers=other).status_code == 404
    assert client.patch(path + "/location", headers=other, json={"latitude":28,"longitude":85}).status_code == 404
    assert client.post(path + "/cancel", headers=other).status_code == 404
    assert client.patch(path, headers=auth(), json={"status":"assigned"}).status_code == 403
    assert client.patch(path + "/navigation", headers=auth(), json={"responder_latitude":29,"responder_longitude":-95,"navigation_status":"en_route"}).status_code == 403
    staff = auth("responder", "worker")
    assert len(client.get("/emergencies", headers=staff).json()) == 2
    assert client.patch(path + "/location", headers=auth(), json={"latitude":29.71,"longitude":-95.4}).status_code == 200
    assigned = client.patch(path, headers=staff, json={"status":"assigned","responder_id":"responder","responder_name":"Test responder"})
    assert assigned.status_code == 200
    assert assigned.json()["assigned_at"]
    assert client.patch(path, headers=staff, json={"status":"resolved"}).status_code == 200
    assert client.get(path, headers=auth()).json()["status"] == "resolved"


def test_built_frontend_routes_and_missing_assets(tmp_path):
    (tmp_path / "index.html").write_text("<html>G-One shell</html>")
    (tmp_path / "g-one-mark.svg").write_text("<svg></svg>")
    app = FastAPI()
    @app.get("/api/v1/check")
    def check():
        return {"ok": True}
    mount_frontend(app, str(tmp_path))
    with TestClient(app) as client:
        for path in ("/", "/citizen", "/responder", "/admin"):
            assert "G-One shell" in client.get(path).text
            assert client.get(path).headers["cache-control"] == "no-cache"
        assert client.get("/g-one-mark.svg").status_code == 200
        assert client.get("/api/v1/check").json() == {"ok":True}
        assert client.get("/api/v1/missing").status_code == 404
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/.env").status_code == 404


@pytest.mark.parametrize("prefix", ["postgres://", "postgresql://", "postgresql+psycopg://"])
def test_managed_database_urls_use_installed_driver(prefix):
    config = Settings(_env_file=None, jwt_secret="test", database_url=prefix + "user:pass@db/gone")
    assert config.database_url == "postgresql+psycopg://user:pass@db/gone"
