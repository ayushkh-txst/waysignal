from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.emergencies import router as emergencies_router
from app.api.v1.routing import router as routing_router
from app.api.v1.safety import router as safety_router
from app.api.v1.hazards import router as hazards_router
from app.api.v1.reports import router as reports_router
from app.api.v1.citizen_map import router as citizen_map_router
from app.api.v1.dispatch import router as dispatch_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(safety_router, prefix="/safety", tags=["safety"])
api_router.include_router(emergencies_router, prefix="/emergencies", tags=["emergencies"])
api_router.include_router(routing_router, prefix="/routing", tags=["routing"])
api_router.include_router(hazards_router, prefix="/hazards", tags=["hazards"])
api_router.include_router(reports_router, prefix="/admin/reports", tags=["reports"])
api_router.include_router(citizen_map_router, prefix="/citizen-map", tags=["citizen-map"])
api_router.include_router(dispatch_router, prefix="/admin/dispatch", tags=["dispatch"])
