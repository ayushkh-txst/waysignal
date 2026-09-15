"""Integration contracts: review -> route, authorized MCP, source-summary host."""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "isolated-test-secret-not-for-deployment-0123456789")

import httpx
import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mcp.client.streamable_http import streamablehttp_client
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1 import hazards, emergencies
from app.core import database
from app.core.config import settings
from app.waysignal import api, guide
from app.waysignal.domain import AssessmentInput, distance_to_route
from app.waysignal.mcp_server import AuthenticatedMCP, build_mcp
from app.waysignal.routes import GOneRouteProvider, RouteAssessmentService


def auth(subject="alice", role="citizen"):
    now = datetime.now(timezone.utc)
    token = jwt.encode({"sub": subject, "role": role, "iat": now, "exp": now + timedelta(minutes=5)},
                       settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": "Bearer " + token}


@pytest.fixture
def app_api(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'waysignal.db'}", connect_args={"check_same_thread": False})
    database.Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    mcp = build_mcp()

    @asynccontextmanager
    async def lifespan(app):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(lifespan=lifespan)
    app.include_router(hazards.router, prefix="/hazards")
    app.include_router(emergencies.router, prefix="/emergencies")
    app.include_router(api.router, prefix="/mobile")
    app.mount("/mcp", AuthenticatedMCP(mcp.streamable_http_app()))
    def db():
        with sessions() as session:
            yield session
    app.dependency_overrides[database.get_db] = db
    with TestClient(app) as client:
        yield app, client, sessions
    engine.dispose()


def report(client):
    response = client.post("/hazards", headers=auth(), json={"client_request_id": str(uuid4()),
        "kind": "road_blocked", "latitude": 29.7, "longitude": -95.4})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def routes():
    return [
        {"geometry": {"coordinates": [[-95.41, 29.7], [-95.39, 29.7]]}, "distance": 2000, "duration": 240},
        {"geometry": {"coordinates": [[-95.41, 29.701], [-95.39, 29.701]]}, "distance": 2200, "duration": 300},
    ]


INPUT = {"origin": {"latitude": 29.7, "longitude": -95.41},
         "destination": {"latitude": 29.7, "longitude": -95.39}, "destination_name": "Demo destination"}


def test_review_authorization_version_history_and_reopen(app_api):
    _, client, _ = app_api
    key = report(client)
    path = f"/mobile/community/{key}/review"
    body = {"decision": "reviewed_active", "note": "Reviewed by demo responder", "expected_version": 0}
    assert client.post(path, headers=auth(), json=body).status_code == 403
    reviewed = client.post(path, headers=auth("worker", "worker"), json=body)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["review_state"] == "reviewed_active"
    assert reviewed.json()["review_version"] == 1
    assert client.post(path, headers=auth("worker", "worker"), json=body).status_code == 409
    history = client.get(f"/mobile/community/{key}/history", headers=auth()).json()
    assert len(history) == 1 and "actor" not in history[0]
    client.patch(f"/hazards/{key}", headers=auth("worker", "worker"), json={"status": "resolved"})
    assert client.get("/mobile/community", headers=auth()).json()[0]["review_state"] == "resolved"
    client.patch(f"/hazards/{key}", headers=auth("worker", "worker"), json={"status": "active"})
    assert client.get("/mobile/community", headers=auth()).json()[0]["review_state"] == "unreviewed"


def test_rejected_report_removes_legacy_active_marker(app_api):
    _, client, _ = app_api
    key = report(client)
    result = client.post(f"/mobile/community/{key}/review", headers=auth("worker", "worker"),
        json={"decision": "rejected", "note": "Duplicate demo observation", "expected_version": 0})
    assert result.json()["review_state"] == "rejected"
    assert result.json()["status"] == "resolved"
    assert client.get("/hazards", headers=auth()).json() == []


def test_route_screening_changes_after_review_and_uses_segments(app_api, monkeypatch):
    _, client, _ = app_api
    async def candidates(self, request): return routes()
    monkeypatch.setattr(GOneRouteProvider, "candidates", candidates)
    key = report(client)
    first = client.post("/mobile/routes/assess", headers=auth(), json=INPUT).json()
    assert first["candidates"][0]["findings"][0]["disposition"] == "review_needed"
    assert not first["candidates"][0]["excluded"]
    client.post(f"/mobile/community/{key}/review", headers=auth("worker", "worker"),
        json={"decision": "reviewed_active", "expected_version": 0})
    second = client.post("/mobile/routes/assess", headers=auth(), json=INPUT).json()
    assert second["candidates"][0]["excluded"]
    assert second["selected_id"] == "route-2"
    assert distance_to_route(29.7, -95.4, [[29.7, -95.41], [29.7, -95.39]]) < 0.01
    assert "not guaranteed safe" in second["notice"]


def test_all_routes_excluded_and_provider_failure_have_no_selected_route(app_api, monkeypatch):
    _, client, _ = app_api
    key = report(client)
    client.post(f"/mobile/community/{key}/review", headers=auth("worker", "worker"),
        json={"decision": "reviewed_active", "expected_version": 0})
    async def one(self, request): return routes()[:1]
    monkeypatch.setattr(GOneRouteProvider, "candidates", one)
    result = client.post("/mobile/routes/assess", headers=auth(), json=INPUT)
    assert result.json()["selected_id"] is None
    async def broken(self, request): raise httpx.ConnectError("offline")
    monkeypatch.setattr(GOneRouteProvider, "candidates", broken)
    failed = client.post("/mobile/routes/assess", headers=auth(), json=INPUT)
    assert failed.status_code == 502 and "selected_id" not in failed.json()


def test_stale_review_requires_new_evidence(app_api):
    _, client, sessions = app_api
    key = report(client)
    with sessions() as db:
        row = db.get(hazards.Hazard, key)
        row.created_at = datetime.now(timezone.utc) - timedelta(days=2)
        row.updated_at = row.created_at
        db.commit()
    assert client.get("/mobile/community", headers=auth()).json()[0]["review_state"] == "expired"
    result = client.post(f"/mobile/community/{key}/review", headers=auth("worker", "worker"),
        json={"decision": "reviewed_active", "expected_version": 0})
    assert result.json()["review_state"] == "reviewed_active"


def rpc(client, method, params, actor=None):
    return client.post("/mcp/", headers={**(actor or auth()), "Accept": "application/json, text/event-stream"},
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})


def test_real_mcp_discovery_and_shared_reports(app_api):
    _, client, _ = app_api
    report(client)
    assert client.post("/mcp/", json={}).status_code == 401
    init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "contract-test", "version": "1"}})
    assert init.status_code == 200, init.text
    discovered = rpc(client, "tools/list", {}).json()["result"]
    assert {t["name"] for t in discovered["tools"]} == {"assess_route", "list_route_reports", "get_assistance_status", "get_local_conditions", "find_nearby_facilities", "list_assistance_requests", "find_shelter_route"}
    call = rpc(client, "tools/call", {"name": "list_route_reports", "arguments": {}}).json()["result"]
    assert not call.get("isError"), call
    assert call["structuredContent"]["reports"] == client.get("/mobile/community", headers=auth()).json()


def test_mcp_enforces_request_ownership_and_completion_does_not_clear_report(app_api):
    _, client, _ = app_api
    key = report(client)
    created = client.post("/emergencies", headers=auth(), json={"citizen_id": "alice", "citizen_name": "Demo participant",
        "emergency_type": "evacuation", "latitude": 29.7, "longitude": -95.4, "people_count": 1, "notes": "Demo only"})
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    own = rpc(client, "tools/call", {"name": "get_assistance_status", "arguments": {"request_id": request_id}}).json()["result"]
    assert not own.get("isError"), own
    assert own["structuredContent"]["status"] == "submitted"
    assert "notes" not in own["structuredContent"] and "latitude" not in own["structuredContent"]
    other = rpc(client, "tools/call", {"name": "get_assistance_status", "arguments": {"request_id": request_id}}, auth("bob")).json()["result"]
    assert other["isError"]
    assert client.get(f"/emergencies/{request_id}", headers=auth("bob")).status_code == 404
    done = client.patch(f"/emergencies/{request_id}", headers=auth("worker", "worker"), json={"status": "resolved"})
    assert done.status_code == 200
    assert client.get("/mobile/community", headers=auth()).json()[0]["status"] == "active"


def test_guide_uses_real_mcp_client_and_source_records(app_api, monkeypatch):
    app, client, _ = app_api
    key = report(client)
    def factory(headers=None, timeout=None, auth=None):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers=headers, timeout=timeout, auth=auth)
    def local_transport(url, **kwargs):
        return streamablehttp_client("http://testserver/mcp/", httpx_client_factory=factory, **kwargs)
    monkeypatch.setattr(guide, "streamablehttp_client", local_transport)
    response = client.post("/mobile/guide", headers=auth(), json={"action": "reports"})
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "source_summary"
    assert response.json()["sources"][0]["id"] == key
    assert response.json()["tool_used"] == "list_route_reports"
    assert client.post("/mobile/guide", headers=auth(), json={"action": "route"}).status_code == 422

@pytest.fixture
def demo_api(app_api, monkeypatch, tmp_path):
    from app.waysignal import scenario
    from app.api.v1 import safety, citizen_map, routing, reports
    app, client, sessions = app_api
    monkeypatch.setattr(settings, 'waysignal_demo_mode', True)
    monkeypatch.setattr(settings, 'environment', 'development')
    monkeypatch.setattr(settings, 'database_url', f"sqlite:///{tmp_path / 'waysignal-demo.db'}")
    app.include_router(safety.router, prefix='/safety')
    app.include_router(citizen_map.router, prefix='/citizen-map')
    app.include_router(routing.router, prefix='/routing')
    app.include_router(reports.router, prefix='/reports')
    with sessions() as db:
        scenario.seed(db)
    return app, client, sessions


def demo_input():
    from app.waysignal.scenario import ORIGIN, DESTINATION
    return {'origin': ORIGIN, 'destination': DESTINATION, 'destination_name': 'Demo centre'}


def test_demo_populates_scoped_records_weather_places_and_route_without_external_providers(demo_api, monkeypatch):
    _, client, _ = demo_api
    def external(*args, **kwargs): raise AssertionError('Demo contacted a live provider')
    monkeypatch.setattr(httpx, 'AsyncClient', external)
    info = client.get('/mobile/scenario').json()
    assert info['enabled'] and 'synthetic' in info['notice']
    community = client.get('/mobile/community', headers=auth()).json()
    assert len(community) == 5
    assert len(client.get('/emergencies', headers=auth('citizen-demo')).json()) == 4
    assert len(client.get('/emergencies', headers=auth('worker-demo', 'worker')).json()) == 6
    assert client.get('/emergencies', headers=auth('unrelated-citizen')).json() == []
    point = demo_input()['origin']
    weather = client.get('/safety/context', params=point)
    assert weather.status_code == 200, weather.text
    assert weather.json()['precipitation_next_6h_mm'] == 52.4
    assert 'Synthetic' in weather.json()['source']
    places = client.get('/citizen-map/places', params=point, headers=auth())
    assert places.status_code == 200, places.text
    assert len(places.json()['facilities']) == 4
    route = client.get('/routing/evacuation', params=point)
    assert route.status_code == 200, route.text
    assert route.json()['is_demo'] and route.json()['rejected_count'] == 1
    assert client.get('/safety/context', params={'latitude':29.7, 'longitude':-95.4}).status_code == 422


def test_demo_review_changes_route_reset_preserves_custom_work(demo_api):
    from app.waysignal.scenario import seed
    _, client, sessions = demo_api
    initial = client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()
    assert initial['selected_id'] == 'route-1'
    reviewed = client.post('/mobile/community/WS-DEMO-R104/review', headers=auth('worker-demo','worker'),
        json={'decision':'reviewed_active', 'expected_version':0})
    assert reviewed.status_code == 200, reviewed.text
    changed = client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()
    assert changed['selected_id'] == 'route-2' and changed['candidates'][0]['excluded']
    with sessions() as db: seed(db)
    assert client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()['selected_id'] == 'route-2'
    custom = report(client)
    assert client.post('/mobile/scenario/reset', headers=auth()).status_code == 403
    reset = client.post('/mobile/scenario/reset', headers=auth('worker-demo','worker'))
    assert reset.status_code == 200, reset.text
    assert client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()['selected_id'] == 'route-1'
    assert custom in {r['id'] for r in client.get('/mobile/community', headers=auth()).json()}


def test_demo_mcp_agrees_with_rest_and_preserves_assistance_ownership(demo_api):
    _, client, _ = demo_api
    result = rpc(client, 'tools/call', {'name':'assess_route','arguments': demo_input()}).json()['result']
    assert not result.get('isError'), result
    rest = client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()
    assert result['structuredContent']['selected_id'] == rest['selected_id']
    own = rpc(client,'tools/call',{'name':'get_assistance_status','arguments':{'request_id':'WS-DEMO-H208'}},auth('citizen-demo')).json()['result']
    assert not own.get('isError'), own
    other = rpc(client,'tools/call',{'name':'get_assistance_status','arguments':{'request_id':'WS-DEMO-H208'}},auth('someone-else')).json()['result']
    assert other['isError']
    client.patch('/emergencies/WS-DEMO-H208', headers=auth('worker-demo','worker'),json={'status':'resolved'})
    assert next(r for r in client.get('/mobile/community',headers=auth()).json() if r['id']=='WS-DEMO-R104')['review_state']=='unreviewed'


def test_demo_cannot_seed_live_or_production_database(app_api, monkeypatch):
    from app.waysignal.scenario import validate_demo_database
    _, client, _ = app_api
    assert not client.get('/mobile/scenario').json()['enabled']
    assert client.post('/mobile/scenario/reset', headers=auth('worker','worker')).status_code == 409
    monkeypatch.setattr(settings,'waysignal_demo_mode', True)
    monkeypatch.setattr(settings,'database_url', 'sqlite:///jalrakshak-dev.db')
    with pytest.raises(RuntimeError): validate_demo_database()
    monkeypatch.setattr(settings,'database_url', 'sqlite:///waysignal-demo.db')
    monkeypatch.setattr(settings,'environment','production')
    with pytest.raises(RuntimeError): validate_demo_database()


def assistant_transport(app, monkeypatch):
    from app.waysignal import assistant
    from pydantic import SecretStr
    def factory(headers=None, timeout=None, auth=None):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers=headers, timeout=timeout, auth=auth)
    def local_transport(url, **kwargs):
        return streamablehttp_client('http://testserver/mcp/', httpx_client_factory=factory, **kwargs)
    monkeypatch.setattr(assistant, 'streamablehttp_client', local_transport)
    monkeypatch.setattr(settings, 'openai_api_key', SecretStr(''))


def test_observation_note_idempotency_and_owner_projection(app_api):
    _, client, _ = app_api
    body = {'client_request_id': str(uuid4()), 'kind': 'road_blocked', 'latitude':29.7, 'longitude':-95.4,
            'note':'Fallen branches across the path'}
    saved = client.post('/mobile/community', headers=auth(), json=body)
    assert saved.status_code == 201, saved.text
    key = saved.json()['id']
    assert client.post('/mobile/community', headers=auth(), json=body).json()['id'] == key
    assert client.post('/mobile/community', headers=auth(), json={**body, 'note':'different'}).status_code == 409
    mine = client.get('/mobile/community', headers=auth()).json()
    other = client.get('/mobile/community', headers=auth('bob')).json()
    assert len(mine) == 1 and mine[0]['is_mine']
    assert mine[0]['observation'] == body['note']
    assert not other[0]['is_mine'] and other[0]['observation'] == body['note']


def test_assistant_real_mcp_forecast_places_and_request_scope(demo_api, monkeypatch):
    app, client, _ = demo_api
    assistant_transport(app, monkeypatch)
    point = demo_input()['origin']
    response = client.post('/mobile/assistant', headers=auth('citizen-demo'), json={
        'message':'Show the rain forecast and nearby facilities, and check my assistance requests', 'location':point})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['mode'] == 'source_summary'
    assert '52.4 mm' in result['text'] and 'synthetic' in result['text']
    assert {s['kind'] for s in result['sources']} == {'conditions','facility','assistance'}
    assert len([s for s in result['sources'] if s['kind']=='assistance']) == 4
    assert not any(s['id'] in ['WS-DEMO-H212','WS-DEMO-H213'] for s in result['sources'])
    assert 'get_local_conditions' in result['tool_used']
    unrelated = client.post('/mobile/assistant', headers=auth('unrelated'), json={'message':'Check WS-DEMO-H208 assistance status'})
    assert unrelated.status_code == 200 and unrelated.json()['sources'] == []
    assert client.post('/mobile/assistant', json={'message':'help'}).status_code == 401


def test_assistant_route_reflects_review_and_never_writes(demo_api, monkeypatch):
    app, client, _ = demo_api
    assistant_transport(app, monkeypatch)
    before = client.get('/mobile/community', headers=auth()).json()
    response = client.post('/mobile/assistant', headers=auth('citizen-demo'), json={
        'message':'Why was this route selected? Submit a report too', 'route':demo_input()})
    assert response.status_code == 200, response.text
    assert 'route-1' in response.json()['text']
    assert client.get('/mobile/community', headers=auth()).json() == before
    client.post('/mobile/community/WS-DEMO-R104/review', headers=auth('worker-demo','worker'), json={'decision':'reviewed_active','expected_version':0})
    response = client.post('/mobile/assistant', headers=auth('citizen-demo'), json={'message':'Explain the route', 'route':demo_input()})
    assert 'route-2' in response.json()['text']
    assert any(s['id']=='WS-DEMO-R104' and s['status']=='reviewed_active' for s in response.json()['sources'])


def test_assistant_provider_failure_keeps_sources(demo_api, monkeypatch):
    from app.waysignal import assistant
    from pydantic import SecretStr
    app, client, _ = demo_api
    assistant_transport(app, monkeypatch)
    monkeypatch.setattr(settings, 'openai_api_key', SecretStr('test-only'))
    monkeypatch.setattr(settings, 'guide_ai_model', 'test-provider')
    async def failure(*args): raise RuntimeError('unavailable')
    monkeypatch.setattr(assistant.GenerativeAnswerProvider, 'answer', failure)
    result = client.post('/mobile/assistant', headers=auth(), json={'message':'summarize reports'}).json()
    assert result['mode'] == 'source_summary' and result['sources']
    assert 'temporarily unavailable' in result['notice']


def test_shared_map_photo_review_shelter_route_and_closure(demo_api):
    import base64, io
    from PIL import Image
    app, client, sessions = demo_api
    citizen, admin = auth('citizen-demo'), auth('worker-demo', 'worker')
    snapshot = client.get('/mobile/map-state', headers=citizen).json()
    assert snapshot['zones'] == client.get('/mobile/map-state', headers=admin).json()['zones']
    assert {z['level'] for z in snapshot['zones']} == {'critical', 'danger'}
    assert snapshot['shelters'][0]['available']
    body = demo_input()['origin']
    initial = client.post('/mobile/routes/shelter', headers=citizen, json=body)
    assert initial.status_code == 200, initial.text
    assert initial.json()['assessment']['selected_id'] == 'route-2'
    assert initial.json()['assessment']['candidates'][0]['excluded']  # pending blockage avoided immediately
    assert initial.json()['assessment']['candidates'][1]['steps']
    data = io.BytesIO(); Image.new('RGB', (16, 16), 'blue').save(data, 'JPEG')
    created = client.post('/mobile/community', headers=citizen, json={
        'client_request_id': str(uuid4()), 'kind': 'road_blocked', 'latitude': 27.7192,
        'longitude': 85.327, 'note': 'Photo of a blockage on the northern route',
        'photo_base64': base64.b64encode(data.getvalue()).decode()})
    assert created.status_code == 201, created.text
    key = created.json()['id']
    assert client.get(f'/hazards/{key}/photo', headers=admin).status_code == 200
    assert client.get(f'/hazards/{key}/photo', headers=auth('other')).status_code == 403
    updated = client.get('/mobile/map-state', headers=admin).json()
    assert next(z for z in updated['zones'] if z['id'] == key)['level'] == 'danger'
    blocked = client.post('/mobile/routes/shelter', headers=citizen, json=body)
    assert blocked.status_code == 409
    assert client.post(f'/mobile/community/{key}/review', headers=admin, json={
        'decision': 'reviewed_active', 'expected_version': 0, 'note': 'Reviewed the uploaded image'}).status_code == 200
    assert next(z for z in client.get('/mobile/map-state', headers=citizen).json()['zones'] if z['id'] == key)['level'] == 'critical'
    assert client.patch(f'/hazards/{key}', headers=admin, json={'status': 'resolved'}).status_code == 200
    assert key not in [z['id'] for z in client.get('/mobile/map-state', headers=citizen).json()['zones']]
    assert client.post('/mobile/routes/shelter', headers=citizen, json=body).status_code == 200
    assert client.post('/mobile/shelters/WS-DEMO-S1/close', headers=citizen).status_code == 403
    assert client.post('/mobile/shelters/WS-DEMO-S1/close', headers=admin).status_code == 200
    assert not client.get('/mobile/map-state', headers=citizen).json()['shelters'][0]['available']
    assert client.post('/mobile/routes/shelter', headers=citizen, json=body).status_code == 409


def test_shelter_authorization_expiry_hazard_overlap_and_no_fake_safe_areas(app_api):
    from app.waysignal.map_state import Shelter
    _, client, sessions = app_api
    citizen, admin = auth(), auth('worker', 'worker')
    assert client.get('/mobile/map-state').status_code == 401
    assert client.get('/mobile/map-state', headers=citizen).json()['shelters'] == []
    body = {'name': 'Community centre', 'note': 'Site manager confirmed open', 'latitude': 29.7, 'longitude': -95.4}
    assert client.post('/mobile/shelters', headers=citizen, json=body).status_code == 403
    created = client.post('/mobile/shelters', headers=admin, json=body)
    assert created.status_code == 201, created.text
    key = created.json()['id']
    assert client.get('/mobile/map-state', headers=citizen).json()['shelters'][0]['available']
    hazard = report(client)
    site = client.get('/mobile/map-state', headers=citizen).json()['shelters'][0]
    assert not site['available'] and site['status'] == 'near_hazard'
    client.patch(f'/hazards/{hazard}', headers=admin, json={'status': 'resolved'})
    with sessions() as db:
        row = db.get(Shelter, key); row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); db.commit()
    site = client.get('/mobile/map-state', headers=citizen).json()['shelters'][0]
    assert not site['available'] and site['status'] == 'expired'


def test_nav_ai_shelter_tool_matches_map_and_uses_sources(demo_api, monkeypatch):
    app, client, _ = demo_api
    assistant_transport(app, monkeypatch)
    point = demo_input()['origin']
    result = rpc(client, 'tools/call', {'name': 'find_shelter_route', 'arguments': point}).json()['result']
    assert not result.get('isError'), result
    rest = client.post('/mobile/routes/shelter', headers=auth(), json=point).json()
    assert result['structuredContent']['assessment']['selected_id'] == rest['assessment']['selected_id']
    response = client.post('/mobile/assistant', headers=auth(), json={'message': 'Find a route to an open shelter', 'location': point})
    assert response.status_code == 200, response.text
    assert 'find_shelter_route' in response.json()['tool_used']
    assert any(s['kind'] == 'shelter' for s in response.json()['sources'])
