"""Reporting integrity checks against an isolated SQLite database."""
import csv
import io
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "isolated-test-secret-not-for-deployment-0123456789"

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

from app.api.v1.emergencies import Emergency, router as emergencies_router
from app.api.v1.reports import build_report, router as reports_router, safe_cell
from app.core import database
from app.core.database import Base, get_db
from app.core.security import create_access_token


def auth(role="worker"):
    token, _ = create_access_token(subject="report-test", role=role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'reports.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    app = FastAPI()
    app.include_router(emergencies_router, prefix="/emergencies")
    app.include_router(reports_router, prefix="/reports")
    def db():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = db
    with TestClient(app) as client:
        yield client, sessions
    engine.dispose()


def row(id, **values):
    return Emergency(id=id, **{"citizen_id": "test", "citizen_name": "Report Test",
        "emergency_type": "rescue", "latitude": 29.7179, "longitude": -95.402,
        "people_count": 2, "notes": "", "status": "submitted", "is_demo": False,
        "created_at": datetime.now(timezone.utc) - timedelta(hours=2), **values})


def test_aggregates_filters_unknowns_and_demo_exclusion(api):
    client, sessions = api
    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.add_all([
            row("critical", risk_score=88, accuracy_m=12, location_updated_at=now),
            row("medical", risk_score=65, emergency_type="medical", status="resolved", people_count=4,
                assigned_at=now - timedelta(hours=1, minutes=58), resolved_at=now - timedelta(hours=1)),
            row("unknown", risk_score=None, accuracy_m=None, status="assigned"),
            row("cancelled", status="cancelled", people_count=10, risk_score=20),
            row("demo", risk_score=99, is_demo=True, people_count=50),
            row("old", created_at=now - timedelta(days=40)),
        ]); db.commit()
    response = client.get("/reports", headers=auth())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["summary"] == {"total": 4, "critical": 1, "active": 2, "resolved": 1,
        "cancelled": 1, "resolution_percent": 25.0, "people_in_resolved": 4, "people_in_active": 4}
    assert sum(day["total"] for day in data["trend"]) == 4
    assert sum(item["count"] for item in data["incident_types"]) == 4
    assert sum(item["count"] for item in data["severity"]) == 4
    assert data["severity"][-1] == {"key": "unknown", "count": 1}
    assert data["timings"]["acknowledgment"] == {"seconds": None, "samples": 0}
    assert data["timings"]["assignment"]["samples"] == 1
    assert abs(data["timings"]["assignment"]["seconds"] - 120) < 1
    assert data["location_quality"]["counts"] == {"high": 1, "medium": 0, "low": 0, "stale": 0, "unknown": 1}
    assert data["locations_summary"][0]["safe_zone_load"] is None
    assert data["locations"] == ["29.718, -95.402"]
    for params, expected in [({"severity": "unknown"}, 1), ({"incident_type": "medical", "status": "resolved"}, 1),
                             ({"status": "cancelled"}, 1), ({"location": "0, 0"}, 0),
                             ({"severity": "critical", "incident_type": "medical"}, 0)]:
        filtered = client.get("/reports", params=params, headers=auth()).json()
        assert filtered["summary"]["total"] == expected


def test_roles_expiry_and_filter_validation(api):
    client, _ = api
    for path in ("/reports", "/reports/export"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=auth("citizen")).status_code == 403
        assert client.get(path, headers={"Authorization": "Bearer invalid"}).status_code == 401
        assert client.get(path, params={"severity": "made_up"}, headers=auth()).status_code == 422
    for params in ({"start_date": "2020-01-02", "end_date": "2020-01-01"},
                   {"start_date": "2020-01-01", "end_date": "2022-01-01"},
                   {"timezone_name": "invalid/zone"}, {"page": 0}, {"end_date": "2999-01-01"}):
        assert client.get("/reports", params=params, headers=auth()).status_code == 422


def test_manual_gps_filter_validates_and_matches_export(api):
    client, sessions = api
    with sessions() as db:
        db.add_all([row("matching"), row("elsewhere", latitude=29.74),
                    row("zero", latitude=-0.00001, longitude=0.00001),
                    row("edge", latitude=90, longitude=-180)])
        db.commit()
    for value in ("29.71799,-95.40200", "  +29.7180 , -95.4020  "):
        data = client.get("/reports", params={"location": value}, headers=auth()).json()
        assert data["filters"]["location"] == "29.718, -95.402"
        assert data["summary"]["total"] == 1
        assert data["rows"][0]["id"] == "matching"
        export = client.get("/reports/export", params={"location": value}, headers=auth())
        assert export.status_code == 200
        table = list(csv.reader(io.StringIO(export.content.decode("utf-8-sig"))))
        assert len(table[4:]) == 1 and table[4][0] == "matching"
        assert "location=29.718, -95.402" in table[2]
    for value, expected in (("0, -0", "zero"), ("90,-180", "edge")):
        data = client.get("/reports", params={"location": value}, headers=auth()).json()
        assert data["summary"]["total"] == 1 and data["rows"][0]["id"] == expected
    assert client.get("/reports", params={"location": " "}, headers=auth()).json()["summary"]["total"] == 4
    for value in ("91,0", "0,-181", "NaN,0", "Infinity,0", "1e309,0", "29.718", "29.718,", "29,0,1", "0x10,0", "Houston"):
        for endpoint in ("/reports", "/reports/export"):
            assert client.get(endpoint, params={"location": value}, headers=auth()).status_code == 422


def test_empty_report_does_not_invent_metrics(api):
    client, _ = api
    data = client.get("/reports", headers=auth()).json()
    assert data["summary"]["total"] == 0
    assert data["summary"]["resolution_percent"] is None
    assert data["location_quality"]["average_accuracy_m"] is None
    assert all(value == {"seconds": None, "samples": 0} for value in data["timings"].values())
    assert len(data["trend"]) == 7 and not any(item["total"] for item in data["trend"])


def test_lifecycle_clocks_survive_repeated_updates_gps_and_reconnect(api):
    client, sessions = api
    client.headers.update(auth())
    created = client.post("/emergencies", headers=auth("citizen"), json={"citizen_id": "test", "citizen_name": "Test",
        "emergency_type": "rescue", "latitude": 29.7, "longitude": -95.4, "accuracy_m": 35})
    assert created.status_code == 201
    data = created.json(); id = data["id"]
    assert data["created_at"].endswith("Z") and data["location_updated_at"].endswith("Z")
    assert data["acknowledged_at"] is None
    assert client.post(f"/emergencies/{id}/acknowledge", headers=auth("citizen")).status_code == 403
    ack = client.post(f"/emergencies/{id}/acknowledge", headers=auth()).json()["acknowledged_at"]
    assert client.post(f"/emergencies/{id}/acknowledge", headers=auth()).json()["acknowledged_at"] == ack
    update = {"status": "assigned", "responder_id": "worker", "responder_name": "Worker"}
    assigned = client.patch(f"/emergencies/{id}", json=update).json()
    assigned_at = assigned["assigned_at"]
    assert assigned_at and assigned["acknowledged_at"] == ack
    assert client.patch(f"/emergencies/{id}", json=update).json()["assigned_at"] == assigned_at
    gps = client.patch(f"/emergencies/{id}/location", json={"latitude": 29.71, "longitude": -95.41, "accuracy_m": 12}).json()
    assert gps["location_updated_at"] != data["location_updated_at"]
    assert gps["assigned_at"] == assigned_at
    navigation = {"responder_latitude": 29.7, "responder_longitude": -95.4, "navigation_status": "en_route"}
    dispatched = client.patch(f"/emergencies/{id}/navigation", json=navigation).json()
    navigation["navigation_status"] = "on_scene"
    scene = client.patch(f"/emergencies/{id}/navigation", json=navigation).json()
    assert scene["on_scene_at"] and scene["en_route_at"]
    assert scene["en_route_at"] == dispatched["en_route_at"]
    assert scene["location_updated_at"] == gps["location_updated_at"]
    resolved = client.patch(f"/emergencies/{id}", json={"status": "resolved"}).json()
    assert resolved["resolved_at"]
    assert client.patch(f"/emergencies/{id}", json={"status": "resolved"}).json()["resolved_at"] == resolved["resolved_at"]
    sessions.kw["bind"].dispose()
    assert client.get(f"/emergencies/{id}").json()["assigned_at"] == assigned_at
    report = client.get("/reports", headers=auth()).json()
    assert report["timings"]["acknowledgment"]["samples"] == 1
    assert report["timings"]["resolution"]["samples"] == 1


def test_legacy_timing_is_unknown_until_a_new_action(api):
    client, sessions = api
    client.headers.update(auth())
    with sessions() as db:
        db.add(row("legacy", status="assigned", responder_id="worker")); db.commit()
    client.patch("/emergencies/legacy", json={"status": "assigned"})
    client.patch("/emergencies/legacy/location", json={"latitude": 29.7, "longitude": -95.4})
    record = client.get("/emergencies/legacy").json()
    assert record["assigned_at"] is None and record["acknowledged_at"] is None
    assert record["location_updated_at"]
    client.patch("/emergencies/legacy/navigation", json={"responder_latitude": 29.7, "responder_longitude": -95.4, "navigation_status": "on_scene"})
    record = client.get("/emergencies/legacy").json()
    assert record["on_scene_at"] and record["en_route_at"] is None


def test_timezone_dates_and_invalid_durations(api):
    _, sessions = api
    # New York's 23-hour DST day. Both endpoints must be local midnight.
    now = datetime(2026, 3, 10, tzinfo=timezone.utc)
    with sessions() as db:
        db.add_all([row("before", created_at=datetime(2026, 3, 8, 4, 59, tzinfo=timezone.utc)),
                    row("inside", created_at=datetime(2026, 3, 8, 5, tzinfo=timezone.utc), assigned_at=datetime(2026, 3, 7, tzinfo=timezone.utc)),
                    row("last", created_at=datetime(2026, 3, 9, 3, 59, tzinfo=timezone.utc)),
                    row("after", created_at=datetime(2026, 3, 9, 4, tzinfo=timezone.utc))]); db.commit()
        filters = {"start_date": datetime(2026, 3, 8).date(), "end_date": datetime(2026, 3, 8).date(),
                   "zone": ZoneInfo("America/New_York"), "timezone_name": "America/New_York",
                   "severity": None, "incident_type": None, "status": None, "location": None, "page": 1}
        report, _ = build_report(db, filters, now)
    assert report["summary"]["total"] == 2
    assert report["trend"][0]["total"] == 2
    assert report["timings"]["assignment"]["samples"] == 0


def test_csv_matches_filtered_cohort_and_exports_beyond_page(api):
    client, sessions = api
    with sessions() as db:
        db.add_all([row(f"SOS-{i}", emergency_type="medical") for i in range(31)])
        db.add(row("hidden", emergency_type="rescue")); db.commit()
    params = {"incident_type": "medical", "page": 2}
    data = client.get("/reports", params=params, headers=auth()).json()
    assert data["summary"]["total"] == 31 and len(data["rows"]) == 6
    export = client.get("/reports/export", params=params, headers=auth())
    assert export.status_code == 200 and "attachment;" in export.headers["content-disposition"]
    table = list(csv.reader(io.StringIO(export.content.decode("utf-8-sig"))))
    assert len(table[4:]) == 31
    assert all(line[1] == "medical" for line in table[4:])
    assert safe_cell(" =HYPERLINK(1)").startswith("'")


def test_migration_preserves_existing_rows_and_leaves_times_null(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE emergencies (id VARCHAR(32) PRIMARY KEY, notes TEXT)"))
        connection.execute(text("INSERT INTO emergencies VALUES ('legacy', 'keep this record')"))
    monkeypatch.setattr(database, "engine", engine)
    database._ensure_emergency_navigation_columns()
    database._ensure_emergency_navigation_columns()
    assert {"assigned_at", "location_updated_at", "resolved_at"} <= {c["name"] for c in inspect(engine).get_columns("emergencies")}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT notes, assigned_at, location_updated_at FROM emergencies")).one() == ("keep this record", None, None)
    engine.dispose()
