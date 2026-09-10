#!/bin/sh
# Install NextTex on Linux or macOS.  Windows has scripts/install.ps1.
#
# POSIX shell, not bash, and this is not a preference.  The command the
# README gives is `curl ... | sh`, and in that shape the shebang is never
# read: whatever `sh` is on the machine executes the text.  On Debian and
# Ubuntu `sh` is dash, which does not have `set -o pipefail` -- so the
# documented install command died on its seventh line, before printing
# anything, on the most common Linux there is.  Nothing below uses arrays,
# `local`, `[[`, or any other bashism, and the test suite runs this file
# under dash to keep it that way.
#
# This file is a bootstrap and nothing more.  It does the four things that
# cannot be done in Python, because they all happen before any Python is
# known to exist:
#
#   1. refuse to run on a platform this is not for
#   2. check for git, and ask where the checkout should go
#   3. clone, and re-run itself from inside the clone
#   4. find an interpreter, fetching one only if the machine has none
#
# Then it hands over to `python -m nexttex.install`, which surveys the
# machine, prices the whole job, asks once, and does the work.  That half is
# the same code on all three platforms and is covered by the test suite; the
# reason this half is not is that it is what has to run first.
#
# Everything is idempotent: run it again after a change of mind, or after
# installing something it said was missing, and it picks up where it left
# off without touching your projects.
set -eu

# A guard and nothing more.  Which of the two this is stopped mattering here
# when the install moved into Python: `nexttex.install` works it out for
# itself, so there is no longer a variable to carry it.
case "$(uname -s)" in
  Darwin|Linux) ;;
  *) printf '\033[31mThis script is for Linux and macOS. On Windows run scripts/install.ps1 in PowerShell.\033[0m\n' >&2
     exit 1 ;;
esac

# Asking a question when the script itself arrived on stdin.
#
# The documented way to run this is `curl ... | sh`, and in that shape stdin
# *is* the installer.  A bare `read` therefore eats the rest of the script,
# and once it has been eaten `read` fails, which under `set -e` takes the
# whole install down at the first question.  /dev/tty is the person sitting
# there whatever stdin happens to be, so every question goes to it.
#
# Opening it, not stat-ing it.  `[ -r /dev/tty ]` answers a question about
# the device node's permissions and says yes on a machine where the node
# exists but this process has no controlling terminal -- a systemd unit, a
# container build, a CI step.  The open is what actually fails there, with
# ENXIO, and it failed *inside* the prompt, so the install died at the first
# question on exactly the unattended machines this fallback exists for.
#
# And the open happens in a subshell, which is the second half of the same
# lesson.  `{ : < /dev/tty; }` looks like it tests the open and returns a
# status, and in bash it does.  But `:` is a POSIX *special built-in*, and a
# redirection error on one of those is defined to end the shell -- so under
# dash, which is `sh` on Debian and Ubuntu, that line did not report "no
# terminal", it killed the installer outright, before it had printed a
# single word.  A subshell contains the death and hands back a status.
tty_available() { ( exec 3< /dev/tty ) 2>/dev/null; }

ask() {  # ask "the prompt" "what to assume when nobody can be asked"
  if [ "${ASSUME_YES:-0}" = 1 ] || ! tty_available; then
    printf '%s' "$2"
    return 0
  fi
  printf '%s' "$1" > /dev/tty
  IFS= read -r _reply < /dev/tty || _reply=""
  printf '%s' "$_reply"
}

# ~ is only expanded by the shell when the user types it unquoted, and a
# path read with `read` never is, so "~/code/NextTex" would otherwise become
# a directory called "~".
#
# shellcheck disable=SC2088
# SC2088 warns that a tilde in quotes will not expand, which is the whole
# point here: these are case *patterns* matching a literal tilde somebody
# typed, not a tilde this script wants expanded.  Expanding it is what the
# body does.
expand_path() {
  case "$1" in
    "~")   printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    /*)    printf '%s' "$1" ;;
    *)     printf '%s' "$PWD/$1" ;;
  esac
}

die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# Only the two options this half of the install needs.  Everything else is
# parsed by `python -m nexttex.install`, which owns the option list; passing
# an unknown option here is not an error, because it is not this script's to
# know about.
ASSUME_YES=0
DIR_CHOICE="${NEXTTEX_DIR:-}"
for argument in "$@"; do
  case "$argument" in
    --yes|-y) ASSUME_YES=1 ;;
    --dir=*)  DIR_CHOICE="${argument#--dir=}" ;;
    --help|-h)
      cat <<'USAGE'
usage: install.sh [--yes] [--dir=PATH] [--tex=tinytex|none]
                  [--agent=claude|openai|none] [--bind=localhost|both]
                  [--service|--no-service] [--instance=NAME] [--plain]

  --yes       take the defaults and ask nothing.  The plan is still printed,
              so an unattended install still says what it did and did not do.
  --dir       where to install.  The default is ~/apps/NextTex, and
              NEXTTEX_DIR does the same job.  Only meaningful on a first
              install: run from inside a checkout this is already decided.
  --tex       install TinyTeX, or skip it.  Interactively the default is to
              install one; unattended the default is to skip, because 200 MB
              should not be spent without somebody saying so.
  --agent     which writing agent to install now.  The default is none, and
              the app asks again on its first screen either way.
  --bind      where the server listens.  localhost is this machine only;
              both also serves your tailnet address over TLS.
  --instance  install a second, separate NextTex on this machine -- its own
              state, its own port, its own service.
  --plain     no animation; one line per step.  What CI gets anyway.
USAGE
      exit 0 ;;
  esac
done

# Two modes, one script.  Run from inside a checkout it installs that
# checkout; piped from curl there is no checkout yet, so it makes one and
# re-runs itself from inside it.
if [ -f "$(dirname "$0")/../requirements.txt" ] 2>/dev/null; then
  cd "$(dirname "$0")/.."
else
  command -v git >/dev/null 2>&1 || die "NextTex needs git.
  macOS:  xcode-select --install
  Debian: sudo apt install git"

  # Where it goes.  NEXTTEX_DIR and --dir are the answers given in advance;
  # anything else means ask, because somebody running this from a curl pipe
  # has no other moment to say, and the directory is the one decision here
  # that cannot be changed afterwards without moving the install by hand.
  DEFAULT_TARGET="$HOME/apps/NextTex"
  TARGET="$DIR_CHOICE"
  if [ -z "$TARGET" ]; then
    if [ "$ASSUME_YES" = 1 ] || ! tty_available; then
      TARGET="$DEFAULT_TARGET"
    else
      printf '\n\033[1m  Where should NextTex be installed?\033[0m\n' > /dev/tty
      printf '    Everything it needs lives in this one directory, including its\n' > /dev/tty
      printf '    Python environment. Your projects live outside it and are not\n' > /dev/tty
      printf '    touched by an install, an update or an uninstall.\n\n' > /dev/tty
      while :; do
        TARGET="$(ask "    Directory [$DEFAULT_TARGET]: " "$DEFAULT_TARGET")"
        TARGET="$(expand_path "${TARGET:-$DEFAULT_TARGET}")"
        # An existing checkout is fine -- that is the update path below.  So
        # is a directory that does not exist yet, and so is an empty one.
        # Anything else would have git refuse with a message about the
        # working tree rather than about the answer just given.
        if [ -d "$TARGET/.git" ] || [ ! -e "$TARGET" ]; then break; fi
        if [ -d "$TARGET" ] && [ -z "$(ls -A "$TARGET" 2>/dev/null)" ]; then break; fi
        if [ -d "$TARGET" ]; then
          printf '    \033[31m%s already has something in it.\033[0m\n' "$TARGET" > /dev/tty
          printf '    Choose an empty directory, or an existing NextTex checkout to update.\n' > /dev/tty
        else
          printf '    \033[31m%s is a file.\033[0m\n' "$TARGET" > /dev/tty
        fi
      done
    fi
  fi
  TARGET="$(expand_path "$TARGET")"
  REPO="${NEXTTEX_REPO:-https://github.com/dakshitha-a/NextTex.git}"
  if [ -d "$TARGET/.git" ]; then
    printf '\n\033[1m  Updating the checkout at %s\033[0m\n' "$TARGET"
    git -C "$TARGET" pull --ff-only
  else
    printf '\n\033[1m  Cloning into %s\033[0m\n' "$TARGET"
    mkdir -p "$(dirname "$TARGET")"
    # Not --quiet.  This is the one download that happens before any of the
    # installer's own machinery exists, and git's own progress is tty-aware
    # and honest about it.
    git clone "$REPO" "$TARGET"
  fi
  exec "$TARGET/scripts/install.sh" "$@"
fi

# An interpreter to run the installer with.  Any Python 3.10 or newer will
# do: the installer is standard library only and makes its own virtual
# environment, so this does not have to be the Python NextTex ends up
# running on, and it does not have to be able to make a venv either.  A
# Debian python3 without ensurepip is a perfectly good interpreter for this,
# and the installer says so on its survey and fetches uv instead.
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    version=$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)
    major=${version%%.*}; minor=${version##*.}
    if [ -n "$version" ] && [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
      PYTHON="$candidate"; break
    fi
  fi
done

# No Python at all is the one case that forces a download before anything
# can be surveyed, so it says so rather than appearing to hang.
if [ -z "$PYTHON" ] && command -v curl >/dev/null 2>&1; then
  printf '\n  There is no Python 3.10 or newer here, so NextTex will fetch one.\n'
  printf '  uv, about 15 MB, into this directory. Nothing is added to your PATH.\n\n'
  if UV_INSTALL_DIR="$PWD/.uv" UV_NO_MODIFY_PATH=1 \
       curl -fsSL https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 \
     && [ -x .uv/uv ]; then
    ./.uv/uv python install 3.13 >/dev/null 2>&1 || true
    PYTHON="$(./.uv/uv python find 3.13 2>/dev/null || true)"
  fi
fi

[ -n "$PYTHON" ] || die "NextTex needs Python 3.10 or newer, and none was found.
  Install one from https://www.python.org/downloads/, or with your
  package manager, then run this script again."

# The handover.  stdin is pointed at the terminal, because under `curl | sh`
# stdin is this script and is exhausted by now, so the installer's first
# question would see EOF.  With no terminal at all there is nobody to ask,
# and --plain is both the honest output mode and the unattended one.
if tty_available; then
  exec "$PYTHON" -m nexttex.install "$@" < /dev/tty
else
  exec "$PYTHON" -m nexttex.install --plain "$@"
fi
