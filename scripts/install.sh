#!/usr/bin/env bash
# Install NextTex on Linux or macOS.  Windows has scripts/install.ps1.
#
# Everything here is idempotent: run it again after a change of mind about
# how the server should listen, or after installing a missing dependency,
# and it will pick up where it left off without touching your projects.
set -euo pipefail

case "$(uname -s)" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  *) printf '\033[31mThis script is for Linux and macOS. On Windows run scripts/install.ps1 in PowerShell.\033[0m\n' >&2
     exit 1 ;;
esac

# Two modes, one script.  Run from inside a checkout it installs that
# checkout; piped from curl there is no checkout yet, so it makes one and
# re-runs itself from inside it.  A separate bootstrap file would be a
# second thing to keep in step with this one.
if [ -f "$(dirname "$0")/../requirements.txt" ] 2>/dev/null; then
  cd "$(dirname "$0")/.."
else
  command -v git >/dev/null 2>&1 || {
    printf '\033[31mNextTex needs git.\033[0m\n' >&2
    printf '  macOS:  xcode-select --install\n' >&2
    printf '  Debian: sudo apt install git\n' >&2
    exit 1
  }
  TARGET="${NEXTTEX_DIR:-$HOME/apps/NextTex}"
  REPO="${NEXTTEX_REPO:-https://github.com/dakshitha-a/NextTex.git}"
  if [ -d "$TARGET/.git" ]; then
    printf '\n\033[1mUpdating the checkout at %s\033[0m\n' "$TARGET"
    git -C "$TARGET" pull --ff-only
  else
    printf '\n\033[1mCloning into %s\033[0m\n' "$TARGET"
    mkdir -p "$(dirname "$TARGET")"
    git clone --quiet "$REPO" "$TARGET"
  fi
  exec "$TARGET/scripts/install.sh" "$@"
fi
ROOT="$(pwd)"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

ASSUME_YES=0
BIND=""
INSTANCE=""
for argument in "$@"; do
  case "$argument" in
    --yes|-y) ASSUME_YES=1 ;;
    --bind=*) BIND="${argument#--bind=}" ;;
    --instance=*) INSTANCE="${argument#--instance=}" ;;
    --help|-h)
      cat <<'USAGE'
usage: install.sh [--yes] [--bind=localhost|tailscale|both] [--instance=NAME]

  --yes       take the defaults; ask nothing
  --bind      where the server listens.  localhost is this machine only;
              tailscale also serves your tailnet address over TLS.
  --instance  install a second, separate NextTex on this machine -- its own
              state, its own port, its own service.  Without this you get
              the ordinary one, which is what almost everybody wants.
USAGE
      exit 0 ;;
    *) die "unknown option: $argument" ;;
  esac
done

case "$INSTANCE" in
  "" ) ;;
  *[!A-Za-z0-9_-]* ) die "an instance name may only contain letters, digits, - and _" ;;
esac

# Everything an instance has of its own.  Unset, these are the names the
# ordinary install has always used, so an existing one is untouched.
SUFFIX="${INSTANCE:+-$INSTANCE}"
STATE="${XDG_DATA_HOME:-$HOME/.local/share}/nexttex$SUFFIX"
UNIT_NAME="nexttex$SUFFIX"
PLIST_LABEL="com.nexttex.server$SUFFIX"
mkdir -p "$STATE"

# ---------------------------------------------------------------------------
say "Python"

# uv, when it can be had.  It brings its own CPython, so the version this
# runs on stops depending on what the distribution shipped -- and it steps
# straight over the single most common way this used to fail: Debian and
# Ubuntu ship python3 without ensurepip, so `python3 -m venv` fails on a
# fresh machine and the error names a package nobody would guess.
#
# It is installed into the project rather than onto the system.  An
# installer that quietly puts a new tool on your PATH is not one you can
# uninstall by deleting a folder.
UV=""
if command -v uv >/dev/null 2>&1; then
  UV="uv"
elif [ -x .uv/uv ]; then
  UV="$PWD/.uv/uv"
elif command -v curl >/dev/null 2>&1; then
  if UV_INSTALL_DIR="$PWD/.uv" UV_NO_MODIFY_PATH=1 \
       curl -fsSL https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 \
     && [ -x .uv/uv ]; then
    UV="$PWD/.uv/uv"
  fi
fi

# Sharing a project needs iroh, which publishes wheels for Linux, Windows and
# Apple-silicon Macs and no source distribution at all.  So it is installed on
# its own and allowed to fail: everything else in NextTex works without it,
# and the share card says so rather than offering a button that cannot work.
install_iroh() {
  if eval "$1 iroh" >/dev/null 2>&1; then
    note "iroh installed, so projects can be shared with other people"
  else
    note "no iroh build for this platform; everything except sharing a project works"
  fi
}

if [ -n "$UV" ]; then
  note "$($UV --version)"
  "$UV" venv --python 3.13 .venv >/dev/null 2>&1 || "$UV" venv .venv >/dev/null
  VIRTUAL_ENV="$PWD/.venv" "$UV" pip install --quiet -r requirements.txt
  note "dependencies installed into .venv"
  install_iroh "VIRTUAL_ENV=$PWD/.venv $UV pip install --quiet"
else
  PYTHON=""
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      version=$("$candidate" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
      major=${version%%.*}; minor=${version##*.}
      if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then PYTHON="$candidate"; break; fi
    fi
  done
  [ -n "$PYTHON" ] || die "NextTex needs Python 3.10 or newer, and none was found."
  note "$($PYTHON -V) at $(command -v "$PYTHON")"

  if [ ! -x .venv/bin/python ]; then
    if ! "$PYTHON" -m venv .venv 2>/dev/null; then
      if command -v virtualenv >/dev/null 2>&1; then
        note "python3-venv is unavailable; using virtualenv instead"
        virtualenv -p "$PYTHON" .venv >/dev/null
      else
        die "Could not create the virtual environment. On Debian or Ubuntu:
    sudo apt install python3-venv
  then run this script again."
      fi
    fi
  fi
  .venv/bin/python -m pip install --quiet --upgrade pip >/dev/null
  .venv/bin/python -m pip install --quiet -r requirements.txt
  note "dependencies installed into .venv"
  install_iroh ".venv/bin/python -m pip install --quiet"
fi

# ---------------------------------------------------------------------------
say "LaTeX"

have() { command -v "$1" >/dev/null 2>&1; }
# TinyTeX puts its binaries somewhere different on each platform, and MacTeX
# somewhere different again.  All of them go on: a directory that does not
# exist costs nothing.
export PATH="$HOME/.TinyTeX/bin/x86_64-linux:$HOME/.TinyTeX/bin/aarch64-linux:$HOME/Library/TinyTeX/bin/universal-darwin:$HOME/Library/TinyTeX/bin/x86_64-darwin:/Library/TeX/texbin:$HOME/bin:$PATH"

if ! have pdflatex; then
  note "no TeX installation found"
  if [ "$ASSUME_YES" = 1 ]; then reply=y; else
    read -r -p "  Install TinyTeX (about 200 MB, into ~/.TinyTeX)? [Y/n] " reply
  fi
  case "${reply:-y}" in
    [Nn]*) note "skipping; NextTex will start but cannot typeset until TeX is installed" ;;
    *) curl -fsSL https://yihui.org/tinytex/install-bin-unix.sh | sh
       export PATH="$HOME/.TinyTeX/bin/x86_64-linux:$HOME/.TinyTeX/bin/aarch64-linux:$HOME/Library/TinyTeX/bin/universal-darwin:$PATH" ;;
  esac
fi

if have tlmgr; then
  missing=()
  for tool in latexmk biber synctex chktex texcount; do
    have "$tool" || missing+=("$tool")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    note "installing: ${missing[*]}"
    tlmgr install "${missing[@]}" >/dev/null 2>&1 || \
      note "tlmgr could not install some of them; NextTex will say which at startup"
  fi
fi
if ! have pdftotext; then
  note "pdftotext is not installed; reading a folder of papers into a .bib"
  note "  needs it.  It comes with poppler-utils:"
  case "$PLATFORM" in
    macos) note "    brew install poppler" ;;
    *)     note "    sudo apt install poppler-utils   (or your distribution's)" ;;
  esac
fi

for tool in pdflatex latexmk synctex; do
  have "$tool" && note "$tool $(command -v "$tool")" || note "MISSING: $tool"
done

# ---------------------------------------------------------------------------
say "The Claude CLI"

if have claude; then
  note "claude $(claude --version 2>/dev/null | head -1)"
else
  note "not installed"
  if [ "$ASSUME_YES" = 1 ]; then reply=y; else
    read -r -p "  Install it now? [Y/n] " reply
  fi
  case "${reply:-y}" in
    [Nn]*) note "skipping; the agent panel will be inert until it is installed" ;;
    *) curl -fsSL https://claude.ai/install.sh | bash || \
         note "the installer did not finish; see https://claude.ai/download" ;;
  esac
fi
note "you sign in from the browser, not here — nothing to do yet"

# ---------------------------------------------------------------------------
say "The interface"

# Downloaded, not built.  Every machine used to need Node 20+ for the sole
# purpose of producing an artefact that is identical for everyone -- there is
# no `base`, no `define` and no VITE_ variable anywhere in the source, so the
# build CI does is the build you would have done.
#
# Building locally is still the fallback, for a machine that cannot reach
# GitHub or a commit CI has not published yet.
if scripts/fetch-interface.sh 2>&1 | sed 's/^/  /'; then
  :
else
  if [ -n "${NEXTTEX_NODE_BIN:-}" ] && [ -d "$NEXTTEX_NODE_BIN" ]; then
    PATH="$NEXTTEX_NODE_BIN:$PATH"
    export PATH
  fi
  NODE=""
  for candidate in node nodejs; do
    if command -v "$candidate" >/dev/null 2>&1; then
      major=$("$candidate" -v | sed 's/^v//; s/\..*//')
      if [ "$major" -ge 20 ]; then NODE="$candidate"; break; fi
    fi
  done
  if [ -n "$NODE" ]; then
    note "building it here instead ($($NODE -v))"
    (cd frontend && npm ci --no-audit --no-fund --silent && npm run build >/dev/null)
    note "built into frontend/dist"
  elif [ -d frontend/dist ]; then
    note "keeping the interface already built"
  else
    die "Could not download the interface, and there is no Node here to build
  one.  Check your connection, or install Node 20+ from https://nodejs.org
  and run this script again."
  fi
fi

# ---------------------------------------------------------------------------
say "How it listens"

if [ -z "$BIND" ]; then
  if [ "$ASSUME_YES" = 1 ]; then
    BIND=localhost
  else
    echo "  1) localhost only — this machine, over plain HTTP"
    echo "  2) localhost and Tailscale — also reachable from your other devices, over TLS"
    read -r -p "  Choose [1]: " choice
    case "${choice:-1}" in 2) BIND=both ;; *) BIND=localhost ;; esac
  fi
fi

CERT=""; KEY=""
if [ "$BIND" != "localhost" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    note "tailscale is not installed; falling back to localhost only"
    BIND=localhost
  else
    NEXTTEX_INSTANCE="$INSTANCE" ./scripts/gen_cert.sh >/dev/null
    CERT="$STATE/cert.pem"; KEY="$STATE/key.pem"
    note "certificate at $CERT"
  fi
fi

NEXTTEX_INSTANCE="$INSTANCE" .venv/bin/python - "$BIND" "$CERT" "$KEY" "$INSTANCE" <<'PY'
import sys
sys.path.insert(0, ".")
from nexttex.config import Settings

bind, cert, key = sys.argv[1], sys.argv[2], sys.argv[3]
settings = Settings.load()
# A second install cannot share the first's port.  Only chosen on a first
# install: an existing config keeps whatever it was set to.
if len(sys.argv) > 4 and sys.argv[4] and settings.port == 8450:
    settings.port = 8451
settings.localhost = True
settings.tailscale = bind != "localhost"
settings.certfile = cert
settings.keyfile = key
settings.save()
print(f"  listening: localhost{' and tailscale' if settings.tailscale else ''}")
PY

# ---------------------------------------------------------------------------
say "Starting on boot"

if [ "$PLATFORM" = macos ]; then
  # launchd rather than systemd.  RunAtLoad plus KeepAlive is the closest
  # equivalent to `Restart=on-failure` with `enable --now`.
  PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/.venv/bin/python</string>
    <string>$ROOT/server/run.py</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
    <key>NEXTTEX_INSTANCE</key><string>$INSTANCE</string>
    <key>PATH</key><string>$HOME/.local/bin:$HOME/Library/TinyTeX/bin/universal-darwin:/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$STATE/server.log</string>
  <key>StandardErrorPath</key><string>$STATE/server.log</string>
</dict>
</plist>
PLIST_EOF
  note "launch agent written to $PLIST"
  if [ "$ASSUME_YES" = 1 ]; then reply=n; else
    read -r -p "  Start NextTex now and on every login? [Y/n] " reply
  fi
  case "${reply:-y}" in
    [Nn]*) note "start it yourself with: launchctl load $PLIST" ;;
    *) launchctl unload "$PLIST" >/dev/null 2>&1 || true
       launchctl load "$PLIST"
       note "running; logs in $STATE/server.log" ;;
  esac
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT_NAME.service"
  mkdir -p "$(dirname "$UNIT")"
  # The PATH is written out in full on purpose.  Under `systemd --user` it is
  # minimal, and the SDK spawns `claude`, which must find the credentials the
  # browser sign-in wrote -- so HOME has to be right as well.
  cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=NextTex
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=HOME=$HOME
Environment=PYTHONUNBUFFERED=1
Environment=NEXTTEX_INSTANCE=$INSTANCE
Environment=PATH=$HOME/.local/bin:$HOME/.TinyTeX/bin/x86_64-linux:$HOME/.TinyTeX/bin/aarch64-linux:$HOME/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$ROOT/.venv/bin/python $ROOT/server/run.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload
  note "unit written to $UNIT"
  if [ "$ASSUME_YES" = 1 ]; then reply=n; else
    read -r -p "  Start NextTex now and on every login? [Y/n] " reply
  fi
  case "${reply:-y}" in
    [Nn]*) note "start it yourself with: systemctl --user start $UNIT_NAME" ;;
    *) systemctl --user enable --now "$UNIT_NAME"
       loginctl enable-linger "$USER" >/dev/null 2>&1 || \
         note "run 'sudo loginctl enable-linger $USER' to keep it running after you log out"
       note "running" ;;
  esac
else
  note "no systemd --user here; start it with: .venv/bin/python server/run.py"
fi

say "Ready"
NEXTTEX_INSTANCE="$INSTANCE" .venv/bin/python server/run.py --print-url | sed 's/^/  /'
echo
echo "  That link contains your access token. Anyone with it can read and"
echo "  edit your projects, so treat it like a password."
echo
