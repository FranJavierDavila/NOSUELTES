#!/bin/bash
# T85 — build de exportación estática ESPEJO del workflow de CI:
# sin .env y sin src/app/api (el runner de Actions no tiene ninguna de las dos
# cosas), con basePath de subruta /NOSUELTES. Restaura todo al terminar (trap).
set -e
cd /home/z/my-project

if [ -d src/app/api ]; then mv src/app/api /tmp/api-backup-t85; fi
if [ -f .env ]; then mv .env /tmp/env-backup-t85; fi

restore() {
  if [ -d /tmp/api-backup-t85 ]; then
    rm -rf src/app/api
    mv /tmp/api-backup-t85 src/app/api
  fi
  [ -f /tmp/env-backup-t85 ] && mv /tmp/env-backup-t85 .env
  echo "RESTAURADO: src/app/api y .env"
}
trap restore EXIT

rm -rf .next-export out
# EXPORT_DIST_DIR=.next-export: distDir aparte para no invalidar el .next del
# standalone del preview. En CI (workflow) no se define → salida en out/.
STATIC_EXPORT=1 EXPORT_BASE_PATH=/NOSUELTES EXPORT_DIST_DIR=.next-export npx next build 2>&1 | tail -22

echo "=== PREFIJO EN HTML (esperado /NOSUELTES/_next/...) ==="
grep -o '/NOSUELTES/_next/[^"]*' .next-export/index.html | head -3
echo "=== ASSETS CLAVE EN .next-export/ ==="
for f in models/rico.glb models/sherpa.glb models/caras/pieza_cara_asustado.glb models/sherpas/sherpa_rojo.jpg models/sherpas/emotes/r_saludo.png audio/rico/es/cd0e9f33.mp3 cover.png content/sherpas/climber.json; do
  if [ -f ".next-export/$f" ]; then echo "OK    $f"; else echo "FALTA $f"; fi
done
