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
    from app.waysignal.scenario import validate_demo_database, seed
    validate_demo_database()
    database.initialize_database()
    with database.SessionLocal() as db:
        if settings.waysignal_demo_mode:
            seed(db)
        else:
            seed_demo_emergencies(db)
    async with app.state.mcp_server.session_manager.run():
        yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys([settings.frontend_origin] + (["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"] if settings.environment != "production" else []))),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    app.include_router(api_router, prefix="/api/v1")
    app.state.mcp_server = build_mcp()
    app.mount("/mcp", AuthenticatedMCP(app.state.mcp_server.streamable_http_app()))

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_frontend(app, settings.frontend_dist)
    return app


app = create_app()
