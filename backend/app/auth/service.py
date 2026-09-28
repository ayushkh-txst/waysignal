"""Login use case: checks credentials and issues an access token."""
from app.auth.interfaces import UserRepository
from app.auth.schemas import AuthUser, LoginResponse
from app.core.security import create_access_token, verify_password


class InvalidCredentialsError(Exception):
    """Raised for any failed login; callers map it to a generic 401."""


class AuthService:
    """Depends on the UserRepository protocol, so storage can change without touching login logic."""

    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def login(self, *, email: str, password: str) -> LoginResponse:
        # Normalize so "User@Example.com " and "user@example.com" hit the same account.
        user = self._users.get_by_email(email.lower().strip())
        if user is None or not user.is_active or not verify_password(password, user.password_hash):
            # One error for unknown email, disabled account, or wrong password, so the
            # response doesn't reveal which emails exist.
            # NOTE: an unknown email skips verify_password and returns faster, which can
            # leak account existence through timing. Verifying against a dummy hash would close that.
            raise InvalidCredentialsError

        token, expires_in = create_access_token(subject=user.id, role=user.role.value)
        return LoginResponse(
            user=AuthUser(id=user.id, name=user.name, email=user.email, role=user.role),
            access_token=token,
            expires_in=expires_in,
        )
