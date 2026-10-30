#!/usr/bin/env bash
# T58 — E2E (calidad + macizo + emotes + A SACO) con build de PRODUCCIÓN.
set -u
cd /home/z/my-project
echo "=== [1/5] matando servidores previos ==="
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null
sleep 2
echo "=== [2/5] build de producción (reconstruye: código + plantilla ricachón) ==="
npm run build 2>&1 | tail -4 || { echo "BUILD FALLO"; exit 1; }
echo "=== [3/5] arranque daemonizado ==="
python3 scripts/daemonize.py npx bun .next/standalone/server.js > /tmp/t58-server.log 2>&1
sleep 1
code=000
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 --max-time 2 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "server HTTP $code tras ${i}s"
echo "=== [4/5] logger de vida (fondo) ==="
( for k in $(seq 1 60); do
    printf "%s mem_free=%s http=%s\n" "$(date +%H:%M:%S)" "$(awk '/MemAvailable/{print int($2/1024)"MB"}' /proc/meminfo)" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 --max-time 2)" >> /tmp/t58-vida.log
    sleep 8
  done ) &
LIFE=$!
echo "=== [5/5] E2E T58 ==="
python3 scripts/e2e-t58-calidad-cuerda.py
RC=$?
kill $LIFE 2>/dev/null
echo "EXIT_E2E=$RC"
tail -3 /tmp/t58-vida.log
exit $RC
