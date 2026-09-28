"""Storage-agnostic contracts for the auth layer."""
from dataclasses import dataclass
from typing import Protocol

from app.auth.schemas import UserRole


@dataclass(frozen=True)
class UserRecord:
    """Internal user row. Holds the password hash, so it must never be returned by the API."""

    id: str
    name: str
    email: str
    role: UserRole
    password_hash: str
    is_active: bool = True


class UserRepository(Protocol):
    """Anything with get_by_email satisfies this (structural typing), e.g. an in-memory or DB-backed store."""

    def get_by_email(self, email: str) -> UserRecord | None: ...
