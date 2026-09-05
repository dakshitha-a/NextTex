#!/usr/bin/env bash
# Update NextTex to the latest release, keeping everything you have made.
#
# Your projects are never inside this directory: the registry holds paths,
# and the files stay where you put them.  What this touches is the code, the
# Python environment and the built interface.
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

RUNNING=0
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet nexttex 2>/dev/null; then
  RUNNING=1
fi

say "Fetching"
if [ -d .git ]; then
  if [ -n "$(git status --porcelain)" ]; then
    note "you have local changes; stashing them"
    git stash push -u -m "nexttex update $(date -Is)" >/dev/null
    note "restore them later with: git stash pop"
  fi
  before=$(git rev-parse --short HEAD)
  git pull --ff-only
  after=$(git rev-parse --short HEAD)
  if [ "$before" = "$after" ]; then
    note "already up to date at $after"
  else
    note "$before -> $after"
    git log --oneline "$before..$after" | sed 's/^/    /'
  fi
else
  note "not a git checkout; skipping"
fi

say "Dependencies"
.venv/bin/python -m pip install --quiet --upgrade pip >/dev/null
.venv/bin/python -m pip install --quiet --upgrade -r requirements.txt
note "python packages up to date"

if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//; s/\..*//')" -ge 20 ]; then
  (cd frontend && npm install --no-audit --no-fund --silent && npm run build >/dev/null)
  note "interface rebuilt"
else
  note "no usable Node; keeping the interface as it is"
fi

if [ "$RUNNING" = 1 ]; then
  say "Restarting"
  systemctl --user restart nexttex
  note "running"
fi

say "Done"
.venv/bin/python server/run.py --print-url | sed 's/^/  /'
echo
