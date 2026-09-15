#!/usr/bin/env bash
set -euo pipefail
waysignal_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WAYSIGNAL_DEMO_MODE=true
export ENVIRONMENT=development
export DATABASE_URL=sqlite:///./waysignal-demo.db
exec bash "$waysignal_root/scripts/start-backend.sh"
