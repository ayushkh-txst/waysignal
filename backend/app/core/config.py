from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "G-0ne API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://g0ne:g0ne@localhost:5432/g0ne"
    frontend_origin: str = "http://localhost:5173"
    frontend_dist: str = ""
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    # Optional; keys stay on the backend. Alerts/contacts do not require AI.
    openai_api_key: SecretStr = SecretStr("")
    dispatch_ai_model: str = ""

    # Configured demo accounts. Render supplies private passwords in production.
    # Use example.com so Pydantic EmailStr accepts the addresses during validation.
    demo_citizen_email: str = "citizen@example.com"
    demo_citizen_password: SecretStr = SecretStr("CitizenDemo2026!")
    demo_worker_email: str = "worker@example.com"
    demo_worker_password: SecretStr = SecretStr("WorkerDemo2026!")
    # Additional accounts stay disabled until their own password is configured.
    demo_citizen_2_password: SecretStr = SecretStr("")
    demo_citizen_3_password: SecretStr = SecretStr("")
    demo_worker_2_password: SecretStr = SecretStr("")

    @field_validator("demo_citizen_2_password", "demo_citizen_3_password", "demo_worker_2_password")
    @classmethod
    def extra_demo_password(cls, value: SecretStr) -> SecretStr:
        password = value.get_secret_value()
        if password and (not 12 <= len(password) <= 128 or not password.strip()):
            raise ValueError("Additional demo passwords must have 12–128 characters, or be empty to disable the account")
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def postgres_driver(cls, value: str) -> str:
        # Hosting providers supply a standard URL; this app installs psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
