#!/usr/bin/env bash
# Run NextTex for development: reloads on change, binds to loopback only.
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/python -m uvicorn server.main:app \
    --host 127.0.0.1 --port "${NEXTTEX_PORT:-8450}" --reload "$@"
