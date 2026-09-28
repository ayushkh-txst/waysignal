"""HTTP endpoint for login (POST /api/v1/auth/login)."""
from fastapi import APIRouter, HTTPException, status

from app.auth.repositories import InMemoryUserRepository
from app.auth.schemas import LoginRequest, LoginResponse
from app.auth.service import AuthService, InvalidCredentialsError

router = APIRouter()
# Module-level singletons: created once per process when the router is imported.
_users = InMemoryUserRepository()
_auth = AuthService(_users)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    """Exchange email + password for a bearer token."""
    try:
        return _auth.login(email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        # Generic message on purpose; `from exc` keeps the cause in server logs only.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from exc
