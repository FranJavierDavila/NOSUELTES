#!/usr/bin/env bash
# T56 — E2E base camp con build de PRODUCCIÓN (lección T55: next dev + WebGL
# headless = OOM en sandbox de 4 GB). Arranca server, espera, corre E2E y
# captura estado de memoria cada 8 s para diagnosticar cualquier caída.
set -u
cd /home/z/my-project

echo "=== [1/5] matando servidores previos ==="
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; pkill -f "standalone/server.js" 2>/dev/null
sleep 2

echo "=== [2/5] build de producción ==="
if [ ! -f .next/standalone/server.js ] || [ -n "$(find src public -newer .next/standalone/server.js -name '*.ts*' 2>/dev/null | head -1)" ]; then
  npm run build 2>&1 | tail -5 || { echo "BUILD FALLO"; exit 1; }
else
  echo "(build existente y fresco)"
fi

echo "=== [3/5] arranque daemonizado ==="
python3 scripts/daemonize.py npx bun .next/standalone/server.js > /tmp/t56-server.log 2>&1
sleep 1
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 --max-time 2 || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "server HTTP $code tras ${i}s"

echo "=== [4/5] logger de vida (fondo) ==="
( for k in $(seq 1 60); do
    printf "%s mem_free=%s http=%s\n" "$(date +%H:%M:%S)" "$(awk '/MemAvailable/{print int($2/1024)"MB"}' /proc/meminfo)" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 --max-time 2)" >> /tmp/t56-vida.log
    sleep 8
  done ) &
LIFE=$!

echo "=== [5/5] E2E T56 ==="
python3 scripts/e2e-t56-basecamp.py
RC=$?
kill $LIFE 2>/dev/null
echo "EXIT_E2E=$RC"
tail -3 /tmp/t56-vida.log
exit $RC
