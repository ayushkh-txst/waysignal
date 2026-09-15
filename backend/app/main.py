from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.v1.emergencies import seed_demo_emergencies
from app.core import database
from app.core.config import settings
from app.web import mount_frontend


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.initialize_database()
    with database.SessionLocal() as db:
        seed_demo_emergencies(db)
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
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_frontend(app, settings.frontend_dist)
    return app


app = create_app()
