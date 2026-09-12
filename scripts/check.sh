#!/usr/bin/env bash
# Everything that can say "this is still working", in the order it is worth
# hearing.  Fast first: the browser tier takes about seven minutes and the
# Python tier about two, so a mistake in a route should not cost seven
# minutes to find out about.  Both numbers have grown by an order of
# magnitude since this comment was written, and the argument they support
# has only got stronger.
#
#   scripts/check.sh          the fast tier -- types, frontend, Python
#   scripts/check.sh --all    adds the browser tier
#   scripts/check.sh --bench  the benchmarks, against a thesis-shaped project
set -euo pipefail

cd "$(dirname "$0")/.."
# Node 20+ is needed for the frontend tiers.  If the one on PATH is older
# -- which it is on plenty of distributions -- point NEXTTEX_NODE_BIN at a
# newer one rather than changing the system's.
if [ -n "${NEXTTEX_NODE_BIN:-}" ] && [ -d "$NEXTTEX_NODE_BIN" ]; then
  PATH="$NEXTTEX_NODE_BIN:$PATH"
fi
export PATH

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "Types"
(cd frontend && node_modules/.bin/tsc --noEmit -p tsconfig.json)

step "Frontend"
(cd frontend && node_modules/.bin/vitest run)

step "Python"
.venv/bin/python -m pytest tests/ -q

if [ "${1:-}" = "--bench" ]; then
  step "Benchmarks"
  .venv/bin/python -m bench.bench
  exit
fi

if [ "${1:-}" = "--all" ]; then
  step "Frontend build"
  (cd frontend && npm run build >/dev/null)

  # Here rather than in --bench, because the number is a property of the
  # build that has just happened and needs nothing else.  It lived only in
  # the benchmark tier, which is run by hand, so the budget was breached by
  # seventeen kilobytes for an unknown length of time with every routine
  # check passing.
  step "Bundle"
  .venv/bin/python -m bench.bench --bundle-only

  step "Browser"
  (cd e2e && node_modules/.bin/playwright test)
fi

printf '\n\033[32mall green\033[0m\n'
