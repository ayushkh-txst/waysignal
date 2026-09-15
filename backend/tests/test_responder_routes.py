"""Responder directions, origins, hazard screening and non-destructive name migration."""
import httpx
from test_waysignal import app_api, demo_api, auth, INPUT, routes, report
from app.api.v1 import emergencies
from app.waysignal.routes import GOneRouteProvider


def create_request(client, name='Arun Shrestha'):
    response = client.post('/emergencies', headers=auth(), json={
        'citizen_id': 'alice', 'citizen_name': name, 'emergency_type': 'rescue',
        'latitude': 29.7, 'longitude': -95.39, 'people_count': 2, 'notes': 'Waiting at the pickup point.'})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_authorization_and_server_destination(app_api, monkeypatch):
    _, client, sessions = app_api
    key = create_request(client)
    path = f'/mobile/incidents/{key}/route'
    body = {'origin': INPUT['origin'], 'origin_source': 'device'}
    worker = auth('worker', 'worker')
    assert client.post(path, headers=auth(), json=body).status_code == 403
    assert client.post('/mobile/incidents/missing/route', headers=worker, json=body).status_code == 404
    for invalid in ({}, {**body, 'destination': INPUT['destination']},
                    {'origin': {'latitude': 91, 'longitude': 0}}, {'origin_source': 'response_base', 'origin': INPUT['origin']}):
        assert client.post(path, headers=worker, json=invalid).status_code == 422
    assert client.post(path, headers=worker, json={'origin_source': 'response_base'}).status_code == 409
    captured = []
    async def provider(self, request):
        captured.append(request); return routes()
    monkeypatch.setattr(GOneRouteProvider, 'candidates', provider)
    first = client.post(path, headers=worker, json=body)
    assert first.status_code == 200, first.text
    result = first.json()
    assert first.headers['cache-control'] == 'no-store'
    assert result['destination'] == INPUT['destination']
    assert result['origin'] == INPUT['origin'] and result['origin_source'] == 'device'
    assert result['assessment']['selected_id'] == 'route-1'
    assert captured[-1].destination_name == 'Arun Shrestha'
    with sessions() as db:
        record = db.get(emergencies.Emergency, key)
        assert record.status == 'submitted' and record.responder_id is None
        record.latitude = 29.71; record.longitude = -95.38; db.commit()
    updated = client.post(path, headers=worker, json=body).json()
    assert updated['destination'] == {'latitude': 29.71, 'longitude': -95.38}
    assert captured[-1].destination.latitude == 29.71
    with sessions() as db:
        record = db.get(emergencies.Emergency, key); record.status = 'resolved'; db.commit()
    assert client.post(path, headers=worker, json=body).status_code == 409


def test_blockages_and_provider_failure(app_api, monkeypatch):
    _, client, _ = app_api
    key = create_request(client)
    async def one(self, request): return routes()[:1]
    monkeypatch.setattr(GOneRouteProvider, 'candidates', one)
    report(client)
    path = f'/mobile/incidents/{key}/route'
    body = {'origin': INPUT['origin'], 'origin_source': 'manual'}
    response = client.post(path, headers=auth('worker', 'worker'), json=body)
    assert response.status_code == 200, response.text
    result = response.json()['assessment']
    assert result['selected_id'] is None and result['candidates'][0]['excluded']
    async def unavailable(self, request): raise httpx.ConnectError('offline')
    monkeypatch.setattr(GOneRouteProvider, 'candidates', unavailable)
    assert client.post(path, headers=auth('worker', 'worker'), json=body).status_code == 502


def test_location_changed_during_provider_call(app_api, monkeypatch):
    _, client, sessions = app_api
    key = create_request(client)
    async def moves(self, request):
        with sessions() as db:
            record = db.get(emergencies.Emergency, key); record.latitude += .01; db.commit()
        return routes()
    monkeypatch.setattr(GOneRouteProvider, 'candidates', moves)
    response = client.post(f'/mobile/incidents/{key}/route', headers=auth('worker', 'worker'), json={'origin': INPUT['origin']})
    assert response.status_code == 409, response.text


def test_response_base_is_explicit_device_routing_stays_real(demo_api, monkeypatch):
    from app.waysignal.responder_routes import RESPONSE_BASE
    _, client, _ = demo_api
    path = '/mobile/incidents/WS-DEMO-H208/route'
    admin = auth('worker-demo', 'worker')
    simulated = client.post(path, headers=admin, json={'origin_source': 'response_base'})
    assert simulated.status_code == 200, simulated.text
    result = simulated.json()
    assert result['origin'] == RESPONSE_BASE.model_dump()
    assert result['assessment']['data_status'] == 'demo' and result['assessment']['selected_id']
    chosen = next(c for c in result['assessment']['candidates'] if c['id'] == result['assessment']['selected_id'])
    assert chosen['geometry'][0] == [RESPONSE_BASE.latitude, RESPONSE_BASE.longitude]
    assert chosen['geometry'][-1] == [27.7172, 85.321]
    seen = []
    async def real(self, request):
        seen.append(request.origin.model_dump()); return routes()
    monkeypatch.setattr(GOneRouteProvider, 'candidates', real)
    for source in ['device', 'manual']:
        response = client.post(path, headers=admin, json={'origin': INPUT['origin'], 'origin_source': source})
        assert response.status_code == 200, response.text
        assert response.json()['origin'] == INPUT['origin']
        assert response.json()['assessment']['data_status'] == 'available'
        assert 'OSRM' in response.json()['assessment']['source']
    assert seen == [INPUT['origin'], INPUT['origin']]


def test_character_migration_preserves_state_and_custom_names(demo_api):
    from app.waysignal.scenario import seed
    _, client, sessions = demo_api
    custom = create_request(client, 'Demo Citizen')
    with sessions() as db:
        old = db.get(emergencies.Emergency, custom)
        old.citizen_id = 'citizen-demo'; old.status = 'assigned'; old.responder_id = 'worker-demo'
        old.responder_name = 'Demo E-Worker'; old.notes = 'User edited request text'
        old.latitude = 27.71; old.longitude = 85.31
        seeded = db.get(emergencies.Emergency, 'WS-DEMO-H208'); seeded.citizen_name = 'My chosen name'
        db.commit(); db.refresh(old)
        before = (old.updated_at, old.created_at, old.location_updated_at, old.citizen_id)
        seed(db); db.refresh(old); db.refresh(seeded)
        assert old.citizen_name == 'Arun Shrestha' and old.responder_name == 'Asha Karki'
        assert old.status == 'assigned' and old.notes == 'User edited request text'
        assert (old.latitude, old.longitude) == (27.71, 85.31)
        assert (old.updated_at, old.created_at, old.location_updated_at, old.citizen_id) == before
        assert seeded.citizen_name == 'My chosen name'
        seed(db)
        assert old.citizen_name == 'Arun Shrestha'
