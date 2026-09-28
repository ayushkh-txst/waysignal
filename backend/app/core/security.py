"""Password hashing and JWT issuing shared by the auth layer."""
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

# pwdlib's recommended hasher (Argon2) -- salted, slow by design to resist brute force.
_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """Return a salted hash suitable for storage; never store the raw password."""
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Check a login attempt against a stored hash."""
    return _password_hash.verify(password, password_hash)


def create_access_token(*, subject: str, role: str) -> tuple[str, int]:
    """Sign a short-lived JWT for a user.

    Returns the token and its lifetime in seconds so the client knows when to
    re-authenticate. `sub` holds the user id and `role` drives authorization checks.
    """
    expires_in = settings.access_token_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_in
