#!/usr/bin/env bash
# Fetch the interface that belongs to the commit this checkout is on.
#
# The install is a git checkout and stays one -- that is what keeps the
# update button working -- but the interface inside it is built once, by CI,
# rather than on every machine that installs NextTex. This is the half that
# brings it down.
#
#   scripts/fetch-interface.sh [SHA]
#
# Exits 0 having replaced frontend/dist, or non-zero having touched nothing.
# The caller decides what to do about a failure; both install.sh and
# update.sh fall back to building locally when Node is available, so a
# machine that cannot reach GitHub is inconvenienced rather than stopped.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

note() { printf '  %s\n' "$*"; }
fail() { printf '  %s\n' "$*" >&2; exit 1; }

SHA="${1:-}"
if [ -z "$SHA" ]; then
  SHA="$(git rev-parse HEAD 2>/dev/null || true)"
fi
[ -n "$SHA" ] || fail "not a git checkout, so there is no commit to fetch an interface for"

# Which repository to ask.  Read from the remote rather than hardcoded, so a
# fork fetches its own builds and not somebody else's.
REMOTE="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$REMOTE" ] || fail "no origin remote, so there is nowhere to fetch from"
SLUG="$(printf '%s' "$REMOTE" \
  | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##' \
  | sed -E 's#^https://github\.com/##')"
case "$SLUG" in
  */*) : ;;
  *) fail "origin is not a GitHub repository: $REMOTE" ;;
esac

NAME="nexttex-frontend-${SHA}.tar.gz"
BASE="https://github.com/${SLUG}/releases/download/interface"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --location, and fail on a 404 rather than saving GitHub's error page as a
# tarball -- which is what --fail is for and what its absence looks like
# three steps later when tar reports a corrupt archive.
if ! curl -fsSL "$BASE/$NAME" -o "$WORK/$NAME"; then
  fail "no interface has been published for $SHA yet"
fi

# The checksum is advisory: a missing one is not worth refusing over, a
# wrong one is.
if curl -fsSL "$BASE/$NAME.sha256" -o "$WORK/$NAME.sha256" 2>/dev/null; then
  expected="$(awk '{print $1}' "$WORK/$NAME.sha256")"
  actual="$( (sha256sum "$WORK/$NAME" 2>/dev/null || shasum -a 256 "$WORK/$NAME") | awk '{print $1}')"
  [ "$expected" = "$actual" ] || fail "the downloaded interface does not match its checksum"
fi

tar -xzf "$WORK/$NAME" -C "$WORK"
[ -f "$WORK/dist/index.html" ] || fail "the downloaded interface has no index.html"
# The same assertion CI makes, checked again here: an install serving
# uncompressed assets is a 3.7x heavier first load and nothing would say so.
if [ "$(find "$WORK/dist/assets" -name '*.br' 2>/dev/null | wc -l)" -lt 3 ]; then
  fail "the downloaded interface has no precompressed assets"
fi

# Swapped rather than emptied and refilled.  update.sh runs while the server
# is still serving out of frontend/dist, and deleting it first would 404
# every asset mid-update -- including the ones drawing the progress the user
# is watching.
mkdir -p "$ROOT/frontend"
rm -rf "$ROOT/frontend/dist.incoming" "$ROOT/frontend/dist.previous"
mv "$WORK/dist" "$ROOT/frontend/dist.incoming"
if [ -d "$ROOT/frontend/dist" ]; then
  mv "$ROOT/frontend/dist" "$ROOT/frontend/dist.previous"
fi
mv "$ROOT/frontend/dist.incoming" "$ROOT/frontend/dist"
rm -rf "$ROOT/frontend/dist.previous"

note "interface ${SHA:0:7} downloaded"
