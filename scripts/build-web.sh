#!/usr/bin/env bash
set -euo pipefail
waysignal_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$waysignal_root/frontend"
npm ci
VITE_API_BASE_URL=/api/v1 npm run build
