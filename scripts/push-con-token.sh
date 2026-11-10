#!/bin/bash
# Push de main a GitHub usando el token guardado en .token-github.
# El token NO se imprime jamás; el helper lo lee del fichero en cada llamada.
# Uso:  bash scripts/push-con-token.sh [fichero-con-token]
set -e
cd /home/z/my-project
TOKEN_FILE="${1:-/home/z/my-project/.token-github}"
if [ $# -gt 0 ]; then shift; fi  # el fichero del token NO es un refspec
if [ ! -s "$TOKEN_FILE" ]; then
  echo "ERROR: no existe o está vacío $TOKEN_FILE" >&2
  exit 1
fi
chmod 600 "$TOKEN_FILE"
export SHERPAS_TOKEN_FILE="$TOKEN_FILE"
exec git \
  -c credential.helper='!f() { echo "username=sherpas-deploy"; echo "password=$(cat "$SHERPAS_TOKEN_FILE")"; }; f' \
  push origin main "$@"
