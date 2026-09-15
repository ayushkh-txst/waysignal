from enum import StrEnum

from pydantic import BaseModel, EmailStr, Field


class UserRole(StrEnum):
    CITIZEN = "citizen"
    WORKER = "worker"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class AuthUser(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: UserRole


class LoginResponse(BaseModel):
    user: AuthUser
    access_token: str
    token_type: str = "bearer"
    expires_in: int
