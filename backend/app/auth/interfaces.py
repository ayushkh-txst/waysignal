from dataclasses import dataclass
from typing import Protocol

from app.auth.schemas import UserRole


@dataclass(frozen=True)
class UserRecord:
    id: str
    name: str
    email: str
    role: UserRole
    password_hash: str
    is_active: bool = True


class UserRepository(Protocol):
    def get_by_email(self, email: str) -> UserRecord | None: ...
