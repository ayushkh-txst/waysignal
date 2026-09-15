#!/usr/bin/env bash
set -euo pipefail
waysignal_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$waysignal_root/frontend"
npm ci
exec npm run dev -- --host 127.0.0.1
