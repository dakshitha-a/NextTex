#!/usr/bin/env bash
# Update NextTex to the latest release, keeping everything you have made.
#
# Your projects are never inside this directory: the registry holds paths,
# and the files stay where you put them.  What this touches is the code, the
# Python environment and the built interface.
set -euo pipefail
# Resolved before the cd, because after it "$0" may no longer name this file.
# Needed so the script can hand over to its own updated self, below.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
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

# An update is the operation most likely to leave a machine in a state its
# owner cannot explain, and it was the one operation that wrote nothing
# down.  The install has install.log and that is what makes an install
# diagnosable after the fact; this is the same file for the update, beside
# it.  Run from the page the output also goes to the job's in-memory log,
# which lives exactly as long as the tab watching it.
#
# Appended rather than replaced, because the interesting question is
# usually "what did the last three updates do".
UPDATE_LOG="${XDG_DATA_HOME:-$HOME/.local/share}/nexttex${INSTANCE:+-$INSTANCE}/update.log"

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
  if [ -n "${NEXTTEX_UPDATE_RESUMED:-}" ]; then
    note "$NEXTTEX_UPDATE_RESUMED -> $(git rev-parse --short HEAD), already fetched"
  elif [ -d .git ]; then
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
      # Hand over to the version just pulled, and let it do the rest.
      #
      # Parsing the whole file up front (see above) stops bash reading
      # garbage, but it also means the *old* script is what runs every
      # step after this one.  So an update that adds an install step is
      # exactly the update that skips it -- which is how a release that
      # added iroh landed on a machine without installing it, leaving
      # sharing switched off until the next unrelated update happened by.
      #
      # Guarded by the variable rather than by a flag, so it survives
      # however the caller invoked this, and so a re-exec loop is
      # impossible even if the pull somehow keeps moving.
      if [ -z "${NEXTTEX_UPDATE_RESUMED:-}" ]; then
        note "continuing with the updated script"
        NEXTTEX_UPDATE_RESUMED="$before" exec "$SELF" "$@"
      fi
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
  # iroh is not in requirements.txt -- it publishes no source distribution,
  # so naming it there would fail the whole update on a platform it has no
  # wheel for. Tried on its own, and allowed to fail: an install that cannot
  # have it keeps everything except sharing a project.
  if [ -x .uv/uv ]; then
    VIRTUAL_ENV="$PWD/.venv" .uv/uv pip install --quiet --upgrade iroh >/dev/null 2>&1 || true
  elif command -v uv >/dev/null 2>&1; then
    VIRTUAL_ENV="$PWD/.venv" uv pip install --quiet --upgrade iroh >/dev/null 2>&1 || true
  else
    .venv/bin/python -m pip install --quiet --upgrade iroh >/dev/null 2>&1 || true
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

# Passed through, because the hand-over above re-execs with them: without
# this "$@" inside main is empty and a resumed update would silently lose
# --no-restart, letting systemd stop the server that is running the update.
# `tee -a` rather than a redirect, so the console still shows everything as
# it happens: an update watched from a terminal is the case this has to keep
# working, and the file is for afterwards.
#
# Wrapped once per update rather than once per exec.  `main` hands over to
# the script it just pulled by re-execing this same file, and without the
# guard the resumed run wraps itself in a second `tee` writing to the same
# path, so everything after the pull lands in the log twice.  Exported for
# that reason: it has to survive the exec, the way NEXTTEX_UPDATE_RESUMED
# does.
if [ -z "${NEXTTEX_UPDATE_LOGGED:-}" ] && mkdir -p "$(dirname "$UPDATE_LOG")" 2>/dev/null; then
  export NEXTTEX_UPDATE_LOGGED=1
  {
    printf '\n=== %s  update.sh %s\n' "$(date -Is)" "$*"
    main "$@"
  } 2>&1 | tee -a "$UPDATE_LOG"
else
  main "$@"
fi
