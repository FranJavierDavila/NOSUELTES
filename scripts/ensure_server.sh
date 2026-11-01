#!/bin/bash
# Asegura el dev server de Next (el sandbox recicla procesos entre llamadas)
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 --max-time 3 | grep -q 200; then
  (nohup npx next dev -p 3000 > /tmp/next-dev.log 2>&1 &)
  for i in $(seq 1 60); do
    sleep 3
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 --max-time 3 | grep -q 200; then
      echo "server up (${i}x3s)"; break
    fi
  done
else
  echo "server ya arriba"
fi
