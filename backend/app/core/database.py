"""SQLAlchemy engine/session setup plus lightweight startup schema upgrades."""
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """Parent class for all ORM models; its metadata drives create_all()."""


def _build_engine(url: str):
    # SQLite connections are thread-bound by default; FastAPI serves sync routes from a
    # thread pool, so that check is turned off. pool_pre_ping drops stale connections.
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)


engine = _build_engine(settings.database_url)
# expire_on_commit=False keeps loaded objects usable after commit (e.g. when serializing responses).
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
active_database_url = settings.database_url

# Columns added to `emergencies` after the table first shipped. create_all() never alters
# existing tables, so _ensure_emergency_navigation_columns backfills them. Names/types here
# are fixed constants, which is why building the ALTER statement with an f-string is safe.
_NAVIGATION_COLUMNS = {
    "responder_latitude": "FLOAT",
    "responder_longitude": "FLOAT",
    "recommended_route": "JSON",
    "responder_eta_seconds": "INTEGER",
    "responder_distance_m": "FLOAT",
    "eta_updated_at": "TIMESTAMP",
    "route_updated_at": "TIMESTAMP",
    "navigation_status": "VARCHAR(32)",
    "reroute_reason": "TEXT",
    "acknowledged_at": "TIMESTAMP",
    "assigned_at": "TIMESTAMP",
    "en_route_at": "TIMESTAMP",
    "on_scene_at": "TIMESTAMP",
    "resolved_at": "TIMESTAMP",
    "location_updated_at": "TIMESTAMP",
}


def _ensure_emergency_navigation_columns() -> None:
    """Add navigation/reporting columns without inventing historical timestamps."""
    table_names = set(inspect(engine).get_table_names())
    if "emergencies" not in table_names:
        return
    existing = {column["name"] for column in inspect(engine).get_columns("emergencies")}
    missing = [(name, sql_type) for name, sql_type in _NAVIGATION_COLUMNS.items() if name not in existing]
    if not missing:
        return
    with engine.begin() as connection:
        for name, sql_type in missing:
            # Store timezone-aware timestamps on Postgres.
            if sql_type == "TIMESTAMP" and engine.dialect.name == "postgresql":
                sql_type = "TIMESTAMP WITH TIME ZONE"
            connection.execute(text(f"ALTER TABLE emergencies ADD COLUMN {name} {sql_type}"))


def initialize_database() -> str:
    """Create tables and return the active database URL.

    In development only, fall back to a persistent local SQLite file when the
    configured Postgres service is unavailable. Production never falls back.
    """
    # Rebinds module globals on fallback; code that imported SessionLocal directly
    # before this ran would keep the old reference, so use database.SessionLocal.
    global engine, SessionLocal, active_database_url

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        Base.metadata.create_all(bind=engine)
        _ensure_emergency_navigation_columns()
        return active_database_url
    except SQLAlchemyError:
        if settings.environment == "production" or settings.waysignal_demo_mode:
            raise

        fallback_url = "sqlite:///./jalrakshak-dev.db"
        engine.dispose()
        engine = _build_engine(fallback_url)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        active_database_url = fallback_url
        Base.metadata.create_all(bind=engine)
        _ensure_emergency_navigation_columns()
        print("WARNING: Postgres unavailable; using persistent development SQLite database.")
        return active_database_url


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
