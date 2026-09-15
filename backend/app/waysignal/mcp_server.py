"""Authenticated MCP adapter over the same application services used by REST."""
from typing import Annotated, Any

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from starlette.responses import JSONResponse

from app.api.v1.emergencies import EmergencyRecord, accessible_emergency
from app.api.v1.hazards import signed_reporter
from app.core import database
from app.waysignal.community import CommunityService
from app.waysignal.domain import AssessmentInput, Coordinate, distance_to_route
from app.waysignal.routes import GOneRouteProvider, RouteAssessmentService


class AuthenticatedMCP:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        header = dict(scope.get("headers", [])).get(b"authorization", b"").decode("latin1")
        scheme, _, token = header.partition(" ")
        try:
            credentials = HTTPAuthorizationCredentials(scheme=scheme, credentials=token) if scheme.lower() == "bearer" and token else None
            actor = signed_reporter(credentials)
        except HTTPException:
            return await JSONResponse({"detail": "Sign in to access WaySignal tools."}, 401,
                headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"})(scope, receive, send)
        scope = {**scope, "waysignal_actor": actor}
        return await self.app(scope, receive, send)


def actor_from_context(ctx: Context) -> dict:
    request = ctx.request_context.request
    if request is None or "waysignal_actor" not in request.scope:
        raise ValueError("Authenticated request context is required.")
    return request.scope["waysignal_actor"]


def build_mcp() -> FastMCP:
    server = FastMCP("WaySignal", stateless_http=True, json_response=True, streamable_http_path="/",
        instructions="Read WaySignal source records. Never claim a route is guaranteed safe or a request dispatched without its recorded status.",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*", "testserver"],
            allowed_origins=["http://127.0.0.1:*", "http://localhost:*"]))

    @server.tool()
    async def assess_route(origin: Coordinate, destination: Coordinate, ctx: Context,
                           destination_name: str = "Selected destination") -> dict[str, Any]:
        """Assess actual driving-route candidates using current community review evidence."""
        actor = actor_from_context(ctx)
        with database.SessionLocal() as db:
            request = AssessmentInput(origin=origin, destination=destination, destination_name=destination_name)
            return await RouteAssessmentService(GOneRouteProvider(), CommunityService(db, actor)).assess(request)

    @server.tool()
    def list_route_reports(ctx: Context,
        route_geometry: Annotated[list[Coordinate] | None, Field(max_length=10000)] = None) -> dict[str, Any]:
        """Read public reports; optionally restrict to within 250 metres of the selected route."""
        actor = actor_from_context(ctx)
        with database.SessionLocal() as db:
            reports = CommunityService(db, actor).reports()
        if route_geometry is not None:
            if len(route_geometry) < 2:
                raise ValueError("A route needs at least two coordinates.")
            geometry = [[c.latitude, c.longitude] for c in route_geometry]
            reports = [r for r in reports if distance_to_route(r["latitude"], r["longitude"], geometry) <= 250]
        return {"reports": reports, "scope": "along_route" if route_geometry else "all_reports",
                "notice": "Community observations may be unreviewed or stale; missing reports do not establish safety."}

    @server.tool()
    def get_assistance_status(request_id: str, ctx: Context) -> dict[str, Any]:
        """Read a permitted assistance request. Never includes another citizen's private request."""
        actor = actor_from_context(ctx)
        with database.SessionLocal() as db:
            row = accessible_emergency(db, request_id, actor)
            result = EmergencyRecord.model_validate(row)
            return {"id": result.id, "status": result.status.value,
                "responder_name": result.responder_name, "updated_at": result.updated_at,
                "created_at": result.created_at, "is_demo": result.is_demo,
                "notice": "Status describes a recorded request; no arrival guarantee is implied."}
    return server
