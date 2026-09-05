#!/usr/bin/env bash
# Install NextTex.
#
# Everything here is idempotent: run it again after a change of mind about
# how the server should listen, or after installing a missing dependency,
# and it will pick up where it left off without touching your projects.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STATE="${XDG_DATA_HOME:-$HOME/.local/share}/nexttex"
mkdir -p "$STATE"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

ASSUME_YES=0
BIND=""
for argument in "$@"; do
  case "$argument" in
    --yes|-y) ASSUME_YES=1 ;;
    --bind=*) BIND="${argument#--bind=}" ;;
    --help|-h)
      cat <<'USAGE'
usage: install.sh [--yes] [--bind=localhost|tailscale|both]

  --yes     take the defaults; ask nothing
  --bind    where the server listens.  localhost is this machine only;
            tailscale also serves your tailnet address over TLS.
USAGE
      exit 0 ;;
    *) die "unknown option: $argument" ;;
  esac
done

# ---------------------------------------------------------------------------
say "Python"

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
    # Debian and Ubuntu ship python3 without ensurepip, which is the single
    # most common way this step fails.
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

# ---------------------------------------------------------------------------
say "LaTeX"

have() { command -v "$1" >/dev/null 2>&1; }
export PATH="$HOME/.TinyTeX/bin/x86_64-linux:$HOME/.TinyTeX/bin/aarch64-linux:$HOME/bin:$PATH"

if ! have pdflatex; then
  note "no TeX installation found"
  if [ "$ASSUME_YES" = 1 ]; then reply=y; else
    read -r -p "  Install TinyTeX (about 200 MB, into ~/.TinyTeX)? [Y/n] " reply
  fi
  case "${reply:-y}" in
    [Nn]*) note "skipping; NextTex will start but cannot typeset until TeX is installed" ;;
    *) curl -fsSL https://yihui.org/tinytex/install-bin-unix.sh | sh
       export PATH="$HOME/.TinyTeX/bin/x86_64-linux:$HOME/.TinyTeX/bin/aarch64-linux:$PATH" ;;
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

NODE=""
for candidate in node nodejs; do
  if command -v "$candidate" >/dev/null 2>&1; then
    major=$("$candidate" -v | sed 's/^v//; s/\..*//')
    [ "$major" -ge 20 ] && NODE="$candidate" && break
    note "$($candidate -v) is too old; NextTex needs Node 20 or newer"
  fi
done

if [ -n "$NODE" ]; then
  note "$($NODE -v)"
  (cd frontend && npm install --no-audit --no-fund --silent && npm run build >/dev/null)
  note "built into frontend/dist"
elif [ -d frontend/dist ]; then
  note "no usable Node; keeping the interface already built"
else
  die "NextTex needs Node 20 or newer to build its interface.
  Install it from https://nodejs.org, then run this script again."
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
    ./scripts/gen_cert.sh >/dev/null
    CERT="$STATE/cert.pem"; KEY="$STATE/key.pem"
    note "certificate at $CERT"
  fi
fi

.venv/bin/python - "$BIND" "$CERT" "$KEY" <<'PY'
import sys
sys.path.insert(0, ".")
from nexttex.config import Settings

bind, cert, key = sys.argv[1], sys.argv[2], sys.argv[3]
settings = Settings.load()
settings.localhost = True
settings.tailscale = bind != "localhost"
settings.certfile = cert
settings.keyfile = key
settings.save()
print(f"  listening: localhost{' and tailscale' if settings.tailscale else ''}")
PY

# ---------------------------------------------------------------------------
say "Starting on boot"

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/nexttex.service"
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
    [Nn]*) note "start it yourself with: systemctl --user start nexttex" ;;
    *) systemctl --user enable --now nexttex
       loginctl enable-linger "$USER" >/dev/null 2>&1 || \
         note "run 'sudo loginctl enable-linger $USER' to keep it running after you log out"
       note "running" ;;
  esac
else
  note "no systemd --user here; start it with: .venv/bin/python server/run.py"
fi

say "Ready"
.venv/bin/python server/run.py --print-url | sed 's/^/  /'
echo
echo "  That link contains your access token. Anyone with it can read and"
echo "  edit your projects, so treat it like a password."
echo
