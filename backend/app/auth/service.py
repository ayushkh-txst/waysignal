from app.auth.interfaces import UserRepository
from app.auth.schemas import AuthUser, LoginResponse
from app.core.security import create_access_token, verify_password


class InvalidCredentialsError(Exception):
    pass


class AuthService:
    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def login(self, *, email: str, password: str) -> LoginResponse:
        user = self._users.get_by_email(email.lower().strip())
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            raise InvalidCredentialsError

        token, expires_in = create_access_token(subject=user.id, role=user.role.value)
        return LoginResponse(
            user=AuthUser(id=user.id, name=user.name, email=user.email, role=user.role),
            access_token=token,
            expires_in=expires_in,
        )
