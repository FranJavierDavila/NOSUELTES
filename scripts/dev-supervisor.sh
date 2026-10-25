#!/bin/bash
# Supervisor del dev server: reinicia next dev si el entorno lo mata.
cd /home/z/my-project
while true; do
  echo "[$(date '+%H:%M:%S')] levantando next dev (puerto 3000)" >> /home/z/my-project/dev.log
  bun run dev >> /home/z/my-project/dev.log 2>&1
  code=$?
  echo "[$(date '+%H:%M:%S')] next dev salio con codigo $code; relanzando en 2s" >> /home/z/my-project/dev.log
  sleep 2
done
