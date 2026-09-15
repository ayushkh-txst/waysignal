# G-0ne Auth Contract

Base path: `/api/v1/auth`

## POST `/login`

Request:

```json
{
  "email": "citizen@g0ne.demo",
  "password": "demo-password"
}
```

Success `200`:

```json
{
  "user": {
    "id": "usr_01",
    "name": "Demo Citizen",
    "email": "citizen@g0ne.demo",
    "role": "citizen"
  },
  "access_token": "<short-lived-token>",
  "token_type": "bearer",
  "expires_in": 900
}
```

Invalid credentials `401`:

```json
{
  "detail": "Invalid email or password"
}
```

## GET `/me`

Header: `Authorization: Bearer <access-token>`

Success `200`:

```json
{
  "id": "usr_01",
  "name": "Demo Citizen",
  "email": "citizen@g0ne.demo",
  "role": "citizen"
}
```

## Security rules

- The backend is authoritative for roles.
- Client-side route hiding is not authorization.
- Access tokens are short-lived.
- Refresh-session support will be added separately using secure HttpOnly cookies.
- Passwords are never stored or logged in plaintext.
- Authentication failures use one generic response to reduce account enumeration.
- Third-party/API secrets never ship in the frontend bundle.
