#!/usr/bin/env bash
# Everything that can say "this is still working", in the order it is worth
# hearing.  Fast first: the browser tier takes about twenty-four minutes
# and the Python tier about six (measured in September 2026, and growing
# with the suites; docs/testing.md has the numbers), so a mistake in a
# route should not cost half an hour to find out about.
#
#   scripts/check.sh          the fast tier -- types, frontend, Python
#   scripts/check.sh --all    adds the browser tier
#   scripts/check.sh --bench  the benchmarks, against a thesis-shaped project
set -euo pipefail

cd "$(dirname "$0")/.."
# Node 22.13+ is needed for the frontend tiers.  If the one on PATH is older
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
# CI pins the floor, 3.10, and a newer interpreter here passes code that
# needs something 3.10 does not have until CI says otherwise (Q-016). Said
# rather than refused: a developer's venv is theirs to choose.
if ! .venv/bin/python -c 'import sys; sys.exit(sys.version_info[:2] > (3, 10))'; then
  printf '  note: .venv is Python %s, newer than the 3.10 CI checks with\n' \
    "$(.venv/bin/python -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
fi
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
