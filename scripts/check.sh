#!/usr/bin/env bash
# Everything that can say "this is still working", in the order it is worth
# hearing.  Fast first: the browser tier takes a minute and the Python tier
# takes seven seconds, so a mistake in a route should not cost a minute to
# find out about.
#
#   scripts/check.sh          the fast tier -- types and Python, under 20s
#   scripts/check.sh --all    adds the browser tier
set -euo pipefail

cd "$(dirname "$0")/.."
NODE_BIN="${NEXTTEX_NODE_BIN:-$HOME/apps/miniconda3/envs/node20/bin}"
[ -d "$NODE_BIN" ] && PATH="$NODE_BIN:$PATH"
export PATH

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "Types"
(cd frontend && node_modules/.bin/tsc --noEmit -p tsconfig.json)

step "Frontend"
(cd frontend && node_modules/.bin/vitest run)

step "Python"
.venv/bin/python -m pytest tests/ -q

if [ "${1:-}" = "--all" ]; then
  step "Frontend build"
  (cd frontend && npm run build >/dev/null)

  step "Browser"
  (cd e2e && node_modules/.bin/playwright test)
fi

printf '\n\033[32mall green\033[0m\n'
