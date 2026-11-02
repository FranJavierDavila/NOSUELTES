#!/bin/bash
# Arranca el juego en producción (build standalone) en los puertos del preview.
# Uso: bash scripts/arranca-preview.sh
cd "$(dirname "$0")/.."
# Next renombra su proceso a "next-server": pkill -f "server.js" NO basta
pkill -9 -f next-server 2>/dev/null; sleep 1
for PORT in 3000 3001; do
  (NODE_ENV=production PORT=$PORT nohup node .next/standalone/server.js > /tmp/juego-$PORT.log 2>&1 &)
done
sleep 4
for PORT in 3000 3001; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/)
  echo "puerto $PORT: HTTP $code (log: /tmp/juego-$PORT.log)"
done
