"""Pydantic request/response models for authentication endpoints."""
from enum import StrEnum

from pydantic import BaseModel, EmailStr, Field


class UserRole(StrEnum):
    """Roles embedded in the JWT; citizens report/request help, workers respond."""

    CITIZEN = "citizen"
    WORKER = "worker"


class LoginRequest(BaseModel):
    # Validated at the edge: malformed emails and out-of-range passwords get a 422
    # before any lookup or hashing happens. The max length also caps hashing cost.
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AuthUser(BaseModel):
    """Public view of a user -- deliberately excludes the password hash."""

    id: str
    name: str
    email: EmailStr
    role: UserRole


class LoginResponse(BaseModel):
    """OAuth2-style token response; expires_in is in seconds."""

    user: AuthUser
    access_token: str
    token_type: str = "bearer"
    expires_in: int
