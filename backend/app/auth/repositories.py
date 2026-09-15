from app.auth.interfaces import UserRecord
from app.auth.schemas import UserRole
from app.core.config import Settings, settings
from app.core.security import hash_password


class InMemoryUserRepository:
    def __init__(self, config: Settings | None = None) -> None:
        config = config or settings
        # Keep the original IDs: existing SOS records belong to these identities.
        accounts = [
            ("citizen-demo", "Arun Shrestha", config.demo_citizen_email,
             UserRole.CITIZEN, config.demo_citizen_password),
            ("worker-demo", "Asha Karki", config.demo_worker_email,
             UserRole.WORKER, config.demo_worker_password),
            ("citizen-demo-2", "Mira Tamang", "citizen2@example.com",
             UserRole.CITIZEN, config.demo_citizen_2_password),
            ("citizen-demo-3", "Nisha Rai", "citizen3@example.com",
             UserRole.CITIZEN, config.demo_citizen_3_password),
            ("worker-demo-2", "Dev Sharma", "worker2@example.com",
             UserRole.WORKER, config.demo_worker_2_password),
        ]
        self._users: dict[str, UserRecord] = {}
        for user_id, name, email, role, secret in accounts:
            password = secret.get_secret_value()
            if not password:
                continue
            email = email.lower().strip()
            if email in self._users:
                raise ValueError("Demo account emails must be distinct")
            self._users[email] = UserRecord(
                id=user_id, name=name, email=email, role=role,
                password_hash=hash_password(password),
            )

    def get_by_email(self, email: str) -> UserRecord | None:
        return self._users.get(email.lower().strip())
