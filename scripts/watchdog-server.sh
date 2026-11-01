#!/bin/bash
# Vigilante de :3000 — sustituto tolerante del supervisor cuando su envoltorio
# muere (reciclado del sandbox). NO toca nada mientras el servidor responda 200
# (compatible con cualquier arranque previo); si deja de responder de forma
# sostenida (3 fallos seguidos ≈ 70 s), lo relanza vía ensure_server.sh con el
# techo de heap de T71. El próximo next dev hereda NODE_OPTIONS.
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=1228"
FALLOS=0
while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then
    FALLOS=0
  else
    FALLOS=$((FALLOS+1))
    echo "[$(date '+%H:%M:%S')] vigilante: :3000 responde '$code' (fallo $FALLOS/3)" >> /home/z/my-project/dev.log
    if [ "$FALLOS" -ge 3 ]; then
      echo "[$(date '+%H:%M:%S')] vigilante: relanzando dev server" >> /home/z/my-project/dev.log
      bash /home/z/my-project/scripts/ensure_server.sh >> /home/z/my-project/dev.log 2>&1
      FALLOS=0
    fi
  fi
  sleep 15
done
