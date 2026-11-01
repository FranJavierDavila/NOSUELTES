#!/bin/bash
# Supervisor del dev server: reinicia next dev si el entorno lo mata.
# Techo de heap: el sandbox tiene 4 GB y next dev llegó a 2 GB RSS → OOM kill.
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=1228"
while true; do
  echo "[$(date '+%H:%M:%S')] levantando next dev (puerto 3000)" >> /home/z/my-project/dev.log
  bun run dev >> /home/z/my-project/dev.log 2>&1
  code=$?
  echo "[$(date '+%H:%M:%S')] next dev salio con codigo $code; relanzando en 2s" >> /home/z/my-project/dev.log
  sleep 2
done
