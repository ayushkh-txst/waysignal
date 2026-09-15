"""Shared map evidence and shelter selection, independent of HTTP and native views."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ConfigDict, Field
from sqlalchemy import DateTime, Float, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.config import settings
from app.api.v1.hazards import utc
from app.waysignal.domain import Coordinate, AssessmentInput, distance_to_route, finding
from app.waysignal.community import CommunityService
from app.waysignal.routes import RouteAssessmentService, route_provider


def report_radius(report):
    return max(120.0 if report['kind'] == 'flooded_road' else 60.0,
               min(report.get('accuracy_m') or 0, 250.0))


def active_reports(reports):
    return [r for r in reports if r['status'] == 'active' and r['review_state'] not in ('rejected', 'resolved')]


class Shelter(Base):
    __tablename__ = 'waysignal_shelters'
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(128))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default='open')


class ShelterRouteInput(Coordinate):
    shelter_id: str | None = Field(default=None, max_length=40)


class ShelterInput(Coordinate):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=160)
    note: str = Field(min_length=5, max_length=500)
    valid_hours: int = Field(default=4, ge=1, le=12)


class ShelterRoutePolicy:
    """Avoid reported floods/closures immediately; distinguish review status in findings."""
    def evaluate(self, report, distance_m):
        if report['status'] != 'active' or report['review_state'] in ('rejected', 'resolved') or distance_m > report_radius(report):
            return None
        disposition = 'exclude' if report['review_state'] == 'reviewed_active' or report['kind'] in ('flooded_road', 'road_blocked') else 'review_needed'
        result = finding(report, distance_m, disposition)
        result['reason'] = ('Avoid this reported flood or obstruction; review may still be pending.' if disposition == 'exclude'
                            else 'An unverified observation is near this route. Check its details.')
        return result


class MapStateService:
    def __init__(self, db, actor):
        self.db, self.actor = db, actor
        self.community = CommunityService(db, actor)

    def snapshot(self):
        now = datetime.now(timezone.utc)
        reports = active_reports(self.community.reports())
        zones = [{'id': r['id'], 'name': r['label'], 'latitude': r['latitude'], 'longitude': r['longitude'],
                  'radius_m': report_radius(r), 'level': 'critical' if r['review_state'] == 'reviewed_active' else 'danger',
                  'review_state': r['review_state'], 'updated_at': r['updated_at']} for r in reports]
        shelters = []
        for row in self.db.scalars(select(Shelter).order_by(Shelter.name)).all():
            expiry = utc(row.expires_at)
            point = [[row.latitude, row.longitude], [row.latitude, row.longitude]]
            threatened = any(distance_to_route(r['latitude'], r['longitude'], point) <= report_radius(r) + 40 for r in reports)
            available = row.status == 'open' and expiry > now and not threatened
            shelters.append({'id': row.id, 'name': row.name, 'latitude': row.latitude, 'longitude': row.longitude,
                'radius_m': 40, 'available': available, 'status': 'open' if available else 'closed' if row.status == 'closed' else 'expired' if expiry <= now else 'near_hazard',
                'note': row.note, 'checked_at': utc(row.checked_at).isoformat(), 'expires_at': expiry.isoformat(),
                'source': 'Simulation' if row.id.startswith('WS-DEMO-') else 'Admin confirmation'})
        return {'zones': zones, 'shelters': shelters, 'generated_at': now.isoformat(),
                'is_demo': settings.waysignal_demo_mode,
                'notice': 'Circles show report screening areas, not measured flood boundaries. Green identifies currently open, admin-recorded shelter sites.'}

    def create_shelter(self, payload):
        if self.actor['role'] != 'worker':
            raise HTTPException(403, 'Only admins can confirm shelter locations.')
        now = datetime.now(timezone.utc)
        row = Shelter(id='WS-S-' + uuid4().hex[:12], name=payload.name, latitude=payload.latitude, longitude=payload.longitude,
            note=payload.note, actor=self.actor['sub'], checked_at=now,
            expires_at=now + timedelta(hours=payload.valid_hours), status='open')
        self.db.add(row); self.db.commit()
        return {'id': row.id}

    def close_shelter(self, key):
        if self.actor['role'] != 'worker':
            raise HTTPException(403, 'Only admins can close shelters.')
        row = self.db.get(Shelter, key)
        if row is None: raise HTTPException(404, 'Shelter not found.')
        row.status = 'closed'; self.db.commit()
        return {'id': row.id}

    async def route_to_shelter(self, origin, shelter_id=None):
        snapshot = self.snapshot()
        point = [[origin.latitude, origin.longitude]] * 2
        shelters = sorted((s for s in snapshot['shelters'] if s['available'] and (shelter_id is None or s['id'] == shelter_id)),
                          key=lambda s: distance_to_route(s['latitude'], s['longitude'], point))[:3]
        provider_errors = False
        options = []
        for shelter in shelters:
            try:
                assessment = await RouteAssessmentService(route_provider(), self.community, [ShelterRoutePolicy()]).assess(
                    AssessmentInput(origin=origin, destination=Coordinate(latitude=shelter['latitude'], longitude=shelter['longitude']), destination_name=shelter['name']))
            except HTTPException as error:
                if error.status_code != 502: raise
                provider_errors = True; continue
            selected = next((c for c in assessment['candidates'] if c['id'] == assessment['selected_id']), None)
            if selected: options.append((len(selected['findings']), selected['duration_s'], shelter, assessment))
        if not options:
            raise HTTPException(503 if provider_errors else 409,
                'Route service unavailable. Try again or request assistance.' if provider_errors else
                'No reachable open shelter is currently recorded. Request assistance or ask an admin to confirm a shelter.')
        # Availability may change while a route provider is responding.
        self.db.expire_all()
        current = {site['id']: site for site in self.snapshot()['shelters'] if site['available']}
        options = [option for option in options if option[2]['id'] in current]
        if not options:
            raise HTTPException(409, 'Shelter availability changed. Refresh to find another open shelter.')
        _, _, shelter, assessment = min(options, key=lambda x: x[:2])
        return {'shelter': current[shelter['id']], 'assessment': assessment}
