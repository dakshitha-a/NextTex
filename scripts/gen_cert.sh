#!/bin/sh
# Make the certificate NextTex serves over TLS.
#
# POSIX sh, like the other scripts the installer runs: Alpine has no bash.
#
# A tailnet with HTTPS enabled can issue a real certificate that browsers
# trust; most cannot, so this falls back to a self-signed one carrying every
# name the instance answers to.  The browser will warn once, and the
# connection is still encrypted -- and it is already inside WireGuard.
set -eu
cd "$(dirname "$0")/.."

# The certificate belongs to one install.  A second instance has its own
# state directory, and would otherwise write over the first's.
INSTANCE="${NEXTTEX_INSTANCE:-}"
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nexttex${INSTANCE:+-$INSTANCE}"
mkdir -p "$DIR"
CERT="$DIR/cert.pem"
KEY="$DIR/key.pem"

# The subjectAltName list, built up comma-separated as the names turn up.
SAN=""
add_name() { SAN="${SAN:+$SAN,}$1"; }
if command -v tailscale >/dev/null 2>&1; then
  ip=$(tailscale ip -4 2>/dev/null | head -1 || true)
  dns=$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  dns="${dns%.}"
  [ -n "${ip:-}" ] && add_name "IP:$ip"
  [ -n "${dns:-}" ] && add_name "DNS:$dns"

  # A real certificate, if this tailnet has HTTPS turned on.
  if [ -n "${dns:-}" ] && tailscale cert --cert-file "$CERT" --key-file "$KEY" "$dns" 2>/dev/null; then
    echo "issued by tailscale for $dns"
    chmod 600 "$KEY"
    echo "$CERT"
    exit 0
  fi
fi

add_name "DNS:localhost"
add_name "IP:127.0.0.1"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$KEY" -out "$CERT" \
  -subj "/CN=nexttex" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

chmod 600 "$KEY"
echo "self-signed for $SAN"
echo "$CERT"
