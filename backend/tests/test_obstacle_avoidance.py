"""Regressions for the green route crossing pending debris in the Riverside map."""
from uuid import uuid4

import pytest

from test_waysignal import app_api, demo_api, auth, demo_input
from app.waysignal.domain import distance_to_route, report_radius


def selected(assessment):
    return next(c for c in assessment['candidates'] if c['id'] == assessment['selected_id'])


def assert_clear(client, route):
    reports = client.get('/mobile/community', headers=auth()).json()
    for report in reports:
        if report['status'] == 'active' and report['review_state'] not in ('rejected', 'resolved'):
            distance = distance_to_route(report['latitude'], report['longitude'], route['geometry'])
            assert distance > report_radius(report), (report['id'], distance, route['id'])


@pytest.mark.parametrize('kind', ['debris', 'road_blocked', 'flooded_road'])
def test_pending_obstacle_changes_actual_shelter_geometry(demo_api, kind):
    _, client, _ = demo_api
    origin = demo_input()['origin']
    first = client.post('/mobile/routes/shelter', headers=auth(), json=origin).json()['assessment']
    before = selected(first)
    assert_clear(client, before)
    debris = next(f for c in first['candidates'] for f in c['findings'] if f['report_id'] == 'WS-DEMO-R105')
    assert debris['review_state'] == 'unreviewed' and debris['disposition'] == 'exclude'
    posted = client.post('/mobile/community', headers=auth(), json={
        'client_request_id': str(uuid4()), 'kind': kind,
        'latitude': 27.7206, 'longitude': 85.327, 'note': 'Obstacle across the selected corridor.'})
    assert posted.status_code == 201, posted.text
    response = client.post('/mobile/routes/shelter', headers=auth(), json=origin)
    assert response.status_code == 200, response.text
    after = selected(response.json()['assessment'])
    assert before['geometry'] != after['geometry']
    assert_clear(client, after)
    # Generic destination routing uses the same exclusion rule as the shelter button.
    generic = client.post('/mobile/routes/assess', headers=auth(), json=demo_input()).json()
    assert selected(generic)['geometry'] == after['geometry']
    admin_reports = client.get('/mobile/community', headers=auth('worker-demo', 'worker')).json()
    assert next(r for r in admin_reports if r['id'] == posted.json()['id'])['review_state'] == 'unreviewed'


def test_response_base_route_changes_around_new_pending_debris(demo_api):
    _, client, _ = demo_api
    path = '/mobile/incidents/WS-DEMO-H208/route'
    admin = auth('worker-demo', 'worker')
    body = {'origin_source': 'response_base'}
    first = client.post(path, headers=admin, json=body)
    assert first.status_code == 200, first.text
    before = selected(first.json()['assessment'])
    assert_clear(client, before)
    # Direct approach runs south from the response base to the requester.
    posted = client.post('/mobile/community', headers=auth(), json={
        'client_request_id': str(uuid4()), 'kind': 'debris',
        'latitude': 27.7182, 'longitude': 85.321, 'note': 'Branches across the direct approach.'})
    assert posted.status_code == 201
    second = client.post(path, headers=admin, json=body)
    assert second.status_code == 200, second.text
    after = selected(second.json()['assessment'])
    assert before['geometry'] != after['geometry']
    assert after['geometry'][0] == [27.7192, 85.321]
    assert after['geometry'][-1] == [27.7172, 85.321]
    assert_clear(client, after)


def test_debris_added_while_provider_waits_is_screened(demo_api, monkeypatch):
    from app.waysignal.scenario import DemoRouteProvider
    from app.api.v1.hazards import Hazard
    from datetime import datetime, timezone
    _, client, sessions = demo_api
    original = DemoRouteProvider.candidates
    async def with_new_report(self, request):
        candidates = await original(self, request)
        now = datetime.now(timezone.utc)
        with sessions() as db:
            db.add(Hazard(id='mid-request-obstacle', client_request_id=str(uuid4()), request_hash='test',
                reporter_id='alice', reporter_role='citizen', source='user_reported', kind='debris',
                latitude=27.7206, longitude=85.327, status='active', created_at=now, updated_at=now))
            db.commit()
        return candidates
    monkeypatch.setattr(DemoRouteProvider, 'candidates', with_new_report)
    response = client.post('/mobile/routes/shelter', headers=auth(), json=demo_input()['origin'])
    assert response.status_code == 200, response.text
    route = selected(response.json()['assessment'])
    assert route['id'] == 'route-5'
    assert_clear(client, route)
