#!/usr/bin/env bash
# Make the certificate NextTex serves over TLS.
#
# A tailnet with HTTPS enabled can issue a real certificate that browsers
# trust; most cannot, so this falls back to a self-signed one carrying every
# name the instance answers to.  The browser will warn once, and the
# connection is still encrypted -- and it is already inside WireGuard.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nexttex"
mkdir -p "$DIR"
CERT="$DIR/cert.pem"
KEY="$DIR/key.pem"

names=()
if command -v tailscale >/dev/null 2>&1; then
  ip=$(tailscale ip -4 2>/dev/null | head -1 || true)
  dns=$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  dns="${dns%.}"
  [ -n "${ip:-}" ] && names+=("IP:$ip")
  [ -n "${dns:-}" ] && names+=("DNS:$dns")

  # A real certificate, if this tailnet has HTTPS turned on.
  if [ -n "${dns:-}" ] && tailscale cert --cert-file "$CERT" --key-file "$KEY" "$dns" 2>/dev/null; then
    echo "issued by tailscale for $dns"
    chmod 600 "$KEY"
    echo "$CERT"
    exit 0
  fi
fi

names+=("DNS:localhost" "IP:127.0.0.1")
SAN=$(IFS=,; echo "${names[*]}")

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
