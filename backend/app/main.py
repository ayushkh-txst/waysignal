"""FastAPI entry point: builds the app, wires middleware, routers, MCP, and the frontend."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.v1.emergencies import seed_demo_emergencies
from app.core import database
from app.core.config import settings
from app.web import mount_frontend
from app.waysignal.mcp_server import AuthenticatedMCP, build_mcp


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown hook. Code before `yield` runs once before serving requests."""
    # Imported here to avoid a circular import at module load time.
    from app.waysignal.scenario import validate_demo_database, seed
    validate_demo_database()
    database.initialize_database()
    # Demo mode loads the full scripted WaySignal scenario; otherwise just sample emergencies.
    with database.SessionLocal() as db:
        if settings.waysignal_demo_mode:
            seed(db)
        else:
            seed_demo_emergencies(db)
    # The MCP server's session manager must stay open for the app's whole lifetime.
    async with app.state.mcp_server.session_manager.run():
        yield


def create_app() -> FastAPI:
    """App factory -- tests can call this to get a fresh instance."""
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        # Hide the interactive API docs in production to reduce exposed surface.
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # CORS: only the configured frontend origin in production; local dev servers
    # (Vite on 5173, Uvicorn on 8000) are allowed outside production.
    # dict.fromkeys de-duplicates while preserving order.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys([settings.frontend_origin] + (["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"] if settings.environment != "production" else []))),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    app.include_router(api_router, prefix="/api/v1")
    # MCP endpoint for AI tool access, wrapped so every request must be authenticated.
    app.state.mcp_server = build_mcp()
    app.mount("/mcp", AuthenticatedMCP(app.state.mcp_server.streamable_http_app()))

    # Liveness probe used by the hosting platform.
    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # Mounted last so the SPA catch-all doesn't shadow /api, /mcp, or /health.
    mount_frontend(app, settings.frontend_dist)
    return app


app = create_app()
