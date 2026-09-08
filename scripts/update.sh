#!/usr/bin/env bash
# Update NextTex to the latest release, keeping everything you have made.
#
# Your projects are never inside this directory: the registry holds paths,
# and the files stay where you put them.  What this touches is the code, the
# Python environment and the built interface.
set -euo pipefail
cd "$(dirname "$0")/.."

# If the Node on PATH is too old -- which it is on plenty of distributions --
# point NEXTTEX_NODE_BIN at a newer one rather than changing the system's.
#
# This is only the fallback now.  The interface is downloaded for the commit
# being landed on, so an update triggered from the page needs no Node at all;
# the service file no longer carries a Node directory in its PATH, and that
# is deliberate rather than an oversight.  What this covers is running the
# script by hand on a machine that cannot reach GitHub.
if [ -n "${NEXTTEX_NODE_BIN:-}" ] && [ -d "$NEXTTEX_NODE_BIN" ]; then
  PATH="$NEXTTEX_NODE_BIN:$PATH"
fi
export PATH

INSTANCE=""
RESTART=1
for argument in "$@"; do
  case "$argument" in
    --instance=*) INSTANCE="${argument#--instance=}" ;;
    --no-restart) RESTART=0 ;;
    --help|-h)
      echo "usage: update.sh [--instance=NAME] [--no-restart]"
      exit 0 ;;
    *) printf 'unknown option: %s\n' "$argument" >&2; exit 1 ;;
  esac
done
UNIT="nexttex${INSTANCE:+-$INSTANCE}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# Everything below runs inside a function so bash parses the whole file
# before executing any of it.  Without that, `git pull` replaces this
# script while bash is part-way through reading it, and bash carries on
# at its old byte offset in the new file.
main() {
  RUNNING=0
  if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
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
  # uv if the install has one, pip otherwise -- an install made before uv
  # existed here keeps working without being reinstalled.
  if [ -x .uv/uv ]; then
    VIRTUAL_ENV="$PWD/.venv" .uv/uv pip install --quiet --upgrade -r requirements.txt
  elif command -v uv >/dev/null 2>&1; then
    VIRTUAL_ENV="$PWD/.venv" uv pip install --quiet --upgrade -r requirements.txt
  else
    .venv/bin/python -m pip install --quiet --upgrade pip >/dev/null
    .venv/bin/python -m pip install --quiet --upgrade -r requirements.txt
  fi
  note "python packages up to date"

  # The interface belonging to the commit just landed on.  Downloaded
  # rather than built -- see scripts/fetch-interface.sh -- and swapped into
  # place rather than deleted and refilled, because the server is still
  # serving out of frontend/dist while this runs.
  #
  # The word "interface" has to survive in whatever this prints: the update
  # footer matches on it to name the step the user is watching.
  if scripts/fetch-interface.sh >/dev/null 2>&1; then
    note "interface downloaded"
  elif command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/^v//; s/\..*//')" -ge 20 ]; then
    (cd frontend && npm ci --no-audit --no-fund --silent && npm run build >/dev/null)
    note "interface rebuilt here"
  else
    note "could not fetch the interface and there is no Node to build one; keeping the one in place"
  fi

  if [ "$RUNNING" = 1 ] && [ "$RESTART" = 1 ]; then
    say "Restarting"
    systemctl --user restart "$UNIT"
    note "running"
  elif [ "$RESTART" = 0 ]; then
    # The server is running this script and will restart itself: asking
    # systemd to restart it now would kill the process mid-update.
    note "not restarting; the caller will"
  fi

  say "Done"
  .venv/bin/python server/run.py --print-url | sed 's/^/  /'
  echo
}

main
