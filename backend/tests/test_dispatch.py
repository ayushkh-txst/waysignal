"""Dispatch integration over real SQLite; no emergency calls or live AI requests."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("JWT_SECRET", "isolated-dispatch-tests-not-for-production-0123456789")
os.environ.setdefault("DATABASE_URL", "sqlite://")

import httpx
import jwt
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from pydantic import SecretStr
from app.api.v1 import dispatch
from app.api.v1.emergencies import Emergency
from app.services import dispatch_ai, dispatch_contacts
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import create_app

BASE = '/api/v1/admin/dispatch'
def auth(subject='worker-a', role='worker', expired=False):
    now = datetime.now(timezone.utc)
    token = jwt.encode({'sub': subject, 'role': role, 'iat': now, 'exp': now + timedelta(seconds=-1 if expired else 600)}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {'Authorization': f'Bearer {token}'}

@pytest.fixture
def api(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'dispatch.db'}", connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    app = create_app()
    def db():
        with sessions() as session: yield session
    app.dependency_overrides[get_db] = db
    async def location(lat, lon):
        return {'label': 'Houston test road', 'country': 'US', 'city': 'Houston', 'region': 'Texas', 'source': 'ArcGIS reverse geocoding'}
    monkeypatch.setattr(dispatch_contacts, 'resolve_location', location)
    monkeypatch.setattr(settings, 'openai_api_key', SecretStr(''))
    monkeypatch.setattr(settings, 'dispatch_ai_model', '')
    dispatch._ai_cache.clear(); dispatch._ai_requests.clear(); dispatch_contacts._location_cache.clear()
    client = TestClient(app)
    yield client, sessions, engine
    client.close(); engine.dispose()

def create(client, **changes):
    payload = dict(citizen_id='citizen-a', citizen_name='Test citizen', emergency_type='medical', latitude=29.7179, longitude=-95.402, people_count=2, notes='We need assistance reaching the road.')
    payload.update(changes)
    result = client.post('/api/v1/emergencies', json=payload, headers=auth('citizen-a', 'citizen'))
    assert result.status_code == 201
    return result.json()

@pytest.mark.parametrize('headers,code', [({},401), ({'Authorization':'Bearer fake'},401), (auth(role='citizen'),403), (auth(expired=True),401)])
def test_authentication_on_all_routes(api, headers, code):
    client = api[0]; id = create(client)['id']
    assert client.get(BASE+'/notifications', headers=headers).status_code == code
    assert client.get(BASE+f'/incidents/{id}', headers=headers).status_code == code
    for action in ('review', 'ai-review'):
        assert client.post(BASE+f'/incidents/{id}/{action}', json={'revision':'a'*64}, headers=headers).status_code == code

def test_saved_sos_enters_feed_and_directory(api):
    client = api[0]; record = create(client)
    response = client.get(BASE+'/notifications', headers=auth())
    assert response.headers['cache-control'] == 'no-store'
    feed = response.json()
    assert feed['unread_count'] == 1
    assert feed['items'][0]['incident_id'] == record['id']
    assert feed['items'][0]['suggested_services'] == ['Ambulance / EMS']
    detail = client.get(BASE+f"/incidents/{record['id']}", headers=auth()).json()
    assert [c['phone'] for c in detail['directory']['contacts']] == ['911', '+17138843131']
    assert detail['directory']['contacts'][1]['emergency'] is False
    assert 'caller' in detail['directory']['notice']
    assert 'not collected' in detail['handoff']
    assert detail['location_stale'] is False
    assert datetime.fromisoformat(detail['created_at']).utcoffset() == timedelta(0)

def test_reviews_persist_per_worker_and_material_changes_realert(api):
    client, sessions, engine = api; id = create(client)['id']
    item = client.get(BASE+'/notifications', headers=auth()).json()['items'][0]
    path = BASE+f'/incidents/{id}/review'
    for _ in range(2):
        assert client.post(path, headers=auth(), json={'revision':item['revision']}).status_code == 200
    engine.dispose()
    assert client.get(BASE+'/notifications', headers=auth()).json()['unread_count'] == 0
    assert client.get(BASE+'/notifications', headers=auth('worker-b')).json()['unread_count'] == 1
    with sessions() as db:
        record = db.get(Emergency,id); record.updated_at=datetime.now(timezone.utc); record.responder_eta_seconds=50; db.commit()
    assert client.get(BASE+'/notifications', headers=auth()).json()['unread_count'] == 0
    client.patch('/api/v1/emergencies/'+id+'/location', json={'latitude':27.7172,'longitude':85.324}, headers=auth())
    assert client.get(BASE+'/notifications', headers=auth()).json()['unread_count'] == 1
    assert client.post(path, headers=auth(), json={'revision':item['revision']}).status_code == 409

@pytest.mark.parametrize('status,is_demo', [('resolved',False),('cancelled',False),('submitted',True)])
def test_closed_and_demo_excluded(api, status, is_demo):
    client,sessions,_=api; id=create(client)['id']
    with sessions() as db:
        row=db.get(Emergency,id); row.status=status; row.is_demo=is_demo; db.commit()
    assert client.get(BASE+'/notifications',headers=auth()).json()['items']==[]
    assert client.get(BASE+f'/incidents/{id}',headers=auth()).status_code == (404 if is_demo else 409)

@pytest.mark.parametrize('country,city,region,expected', [('NP','Kathmandu','Bagmati',['102','101','100','+9779851356509']),('US','Austin','Texas',['911']),('GB','London','England',[])])
def test_country_and_city_scope(api, monkeypatch, country, city, region, expected):
    client=api[0]; id=create(client)['id']
    async def location(*_): return dict(label=city,country=country,city=city,region=region,source='ArcGIS reverse geocoding')
    monkeypatch.setattr(dispatch_contacts,'resolve_location',location)
    detail=client.get(BASE+f'/incidents/{id}',headers=auth()).json()
    assert [c['phone'] for c in detail['directory']['contacts']]==expected
    assert all(c['source_url'].startswith('https://') and c['checked_on'] for c in detail['directory']['contacts'])

def test_outage_and_explicit_manual_directory(api,monkeypatch):
    client=api[0]; id=create(client,latitude=0,longitude=0)['id']
    async def fail(*_): raise httpx.ConnectError('test outage')
    monkeypatch.setattr(dispatch_contacts,'resolve_location',fail)
    path=BASE+f'/incidents/{id}'
    data=client.get(path,headers=auth()).json()
    assert data['location']['label']=='0.00000, 0.00000'
    assert data['directory']['contacts']==[]
    data=client.get(path+'?directory=NP',headers=auth()).json()
    assert data['directory']['selection']=='manually selected directory'
    assert data['location']['country'] is None
    assert [c['phone'] for c in data['directory']['contacts']]==['102','101','100']
    assert client.get(path+'?directory=XX',headers=auth()).status_code==422

def test_location_change_during_lookup_refuses_old_contacts(api,monkeypatch):
    client,sessions,_=api; id=create(client)['id']
    async def move(*_):
        with sessions() as db:
            row=db.get(Emergency,id); row.latitude=27.71; row.longitude=85.32; db.commit()
        return dict(label='Houston',country='US',city='Houston',region='Texas',source='test')
    monkeypatch.setattr(dispatch_contacts,'resolve_location',move)
    assert client.get(BASE+f'/incidents/{id}',headers=auth()).status_code==409

def test_ai_unconfigured_failure_and_cache(api,monkeypatch):
    client=api[0]; id=create(client)['id']
    item=client.get(BASE+'/notifications',headers=auth()).json()['items'][0]
    path=BASE+f'/incidents/{id}/ai-review'; payload={'revision':item['revision']}
    assert client.post(path,headers=auth(),json=payload).json()['status']=='not_configured'
    calls=[]
    async def fail(*_): calls.append(1); raise TimeoutError()
    monkeypatch.setattr(dispatch_ai,'review_note',fail)
    assert client.post(path,headers=auth(),json=payload).json()['status']=='unavailable'
    async def review(*_): calls.append(1); return {'status':'complete','signals':[],'notice':'Test review'}
    monkeypatch.setattr(dispatch_ai,'review_note',review)
    assert client.post(path,headers=auth(),json=payload).json()['status']=='complete'
    assert client.post(path,headers=auth(),json=payload).json()['status']=='complete'
    assert len(calls)==2

@pytest.mark.parametrize('evidence,valid', [('cannot walk',True),('invented need',False)])
def test_ai_requires_original_evidence_and_never_controls_contacts(monkeypatch,evidence,valid):
    monkeypatch.setattr(settings,'openai_api_key',SecretStr('test-key'))
    monkeypatch.setattr(settings,'dispatch_ai_model','configured-test-model')
    captured=[]
    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200,json={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps({'signals':[{'kind':'mobility_assistance','evidence':evidence}]})}]}]})
    original=httpx.AsyncClient
    monkeypatch.setattr(dispatch_ai.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler)))
    if valid:
        result=asyncio.run(dispatch_ai.review_note('We cannot walk. Call 713-555-0199 or visit https://example.invalid'))
        assert result['signals'][0]['evidence']=='cannot walk'
    else:
        with pytest.raises(ValueError): asyncio.run(dispatch_ai.review_note('We cannot walk.'))
    assert captured[0]['store'] is False
    assert '713-555-0199' not in captured[0]['input']
    assert 'example.invalid' not in captured[0]['input']
    assert set(captured[0]['text']['format']['schema']['properties'])=={'signals'}

def test_reverse_geocoder_uses_countrycode_not_a_coordinate_box(monkeypatch):
    dispatch_contacts._location_cache.clear()
    requests=[]
    def handler(request):
        requests.append(request)
        return httpx.Response(200,json={'address':{'CountryCode':'NPL','City':'Kathmandu','Region':'Bagmati','LongLabel':'Test Nepal road'}})
    original=httpx.AsyncClient
    monkeypatch.setattr(dispatch_contacts.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler)))
    for _ in range(2):
        assert asyncio.run(dispatch_contacts.resolve_location(27.71,85.32))['country']=='NP'
    assert len(requests)==1 and requests[0].url.params['location']=='85.32,27.71'
