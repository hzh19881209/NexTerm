#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-your.domain.com}"
CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"
CERT_FILE="$CERT_DIR/${DOMAIN}.crt"
KEY_FILE="$CERT_DIR/${DOMAIN}.key"

if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  echo "Certificate already exists: $CERT_FILE"
  exit 0
fi

openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days 825 \
  -keyout "$KEY_FILE" -out "$CERT_FILE" \
  -subj "/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 640 "$KEY_FILE"
chmod 644 "$CERT_FILE"
echo "Created self-signed HTTPS certificate for ${DOMAIN}"
echo "Browsers will show a trust warning until this certificate is installed as trusted."
