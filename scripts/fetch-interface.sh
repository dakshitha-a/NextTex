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
# Exactly `owner/repo`, and nothing that could add path segments.  `*/*`
# accepted anything with a slash in it, including a value carrying `..`,
# which curl then resolves away to a different repository than the one the
# remote names.  Anyone who can set the origin remote can already edit the
# checkout, so this is tidiness rather than a fence, but a URL assembled out
# of a string should be assembled out of a checked one.
printf '%s' "$SLUG" | grep -qE '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' \
  || fail "origin is not a GitHub repository: $REMOTE"

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

# The checksum is required, not advisory.
#
# It used to be skipped entirely when the `.sha256` fetch failed, on the
# grounds that a missing one was not worth refusing over.  But this tarball
# becomes `frontend/dist`, which is the interface every browser on this
# install is served, so a substituted one is script running on the app's own
# origin with the session cookie attached -- and "the checksum could not be
# fetched" is exactly the state an attacker who can answer for one URL can
# produce for the other.  A check that any failure disables is not a check.
#
# CI publishes the pair together and prunes them together, so a tarball with
# no checksum beside it is already an anomaly rather than a normal case.
if ! curl -fsSL "$BASE/$NAME.sha256" -o "$WORK/$NAME.sha256"; then
  fail "no checksum was published for $SHA, so the interface was not installed"
fi
expected="$(awk '{print $1}' "$WORK/$NAME.sha256")"
actual="$( (sha256sum "$WORK/$NAME" 2>/dev/null || shasum -a 256 "$WORK/$NAME") | awk '{print $1}')"
# A malformed or empty checksum file must not compare equal to anything.
case "$expected" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) fail "the published checksum for $SHA is not a sha256" ;;
esac
[ "${#expected}" -eq 64 ] || fail "the published checksum for $SHA is not a sha256"
[ -n "$actual" ] || fail "could not compute a checksum for the downloaded interface"
[ "$expected" = "$actual" ] || fail "the downloaded interface does not match its checksum"

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
