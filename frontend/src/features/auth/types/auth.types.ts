export type UserRole = "citizen" | "worker";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}
