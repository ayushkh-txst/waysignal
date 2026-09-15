#!/usr/bin/env bash
set -euo pipefail
waysignal_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$waysignal_root/backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r requirements.txt
if [ ! -f .env ]; then
  .venv/bin/python - <<'PY'
import os
import secrets
from pathlib import Path
content = '\n'.join([
    'APP_NAME=WaySignal API',
    'ENVIRONMENT=development',
    'DATABASE_URL=sqlite:///./waysignal-dev.db',
    'JWT_SECRET=' + secrets.token_urlsafe(48),
    'ACCESS_TOKEN_MINUTES=120',
    'FRONTEND_ORIGIN=http://localhost:5173',
    'MCP_INTERNAL_URL=http://127.0.0.1:8000/mcp/',
]) + '\n'
fd = os.open('.env', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(content)
print('Created local development configuration. Existing G-one demo accounts are enabled.')
PY
fi
export FRONTEND_DIST="$waysignal_root/frontend/dist"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
