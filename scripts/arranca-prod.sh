#!/usr/bin/env bash
# Arranca el servidor de PRODUCCIÓN standalone (T83) en el puerto 3000.
# Mata el anterior por PID (nunca pkill -f: el shell que invoca contiene la
# misma cadena y se suicida).
set -u
cd /home/z/my-project/.next/standalone || exit 1
pid=$(ss -tlnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "${pid:-}" ]; then kill -9 "$pid" 2>/dev/null; sleep 2; fi
nohup env NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1 bun server.js > /tmp/prod_t87.log 2>&1 &
disown
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "HTTP $code"
