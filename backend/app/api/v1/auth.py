from fastapi import APIRouter, HTTPException, status

from app.auth.repositories import InMemoryUserRepository
from app.auth.schemas import LoginRequest, LoginResponse
from app.auth.service import AuthService, InvalidCredentialsError

router = APIRouter()
_users = InMemoryUserRepository()
_auth = AuthService(_users)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    try:
        return _auth.login(email=payload.email, password=payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from exc
