#!/usr/bin/env bash
# Poll GitHub Actions until the run for a given head SHA completes, then check Pages deployment status.
set -u
TOKEN=$(cat /tmp/.token-github)
REPO="FranJavierDavila/NOSUELTES"
SHA="${1:-40b9ff8}"
DEADLINE=$(( $(date +%s) + 540 ))   # 9 min

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  JSON=$(curl -s "https://api.github.com/repos/${REPO}/actions/runs?head_sha=${SHA}&per_page=1" \
    -H "Authorization: Bearer $TOKEN")
  ROW=$(echo "$JSON" | python3 -c "
import json,sys
runs=json.load(sys.stdin).get('workflow_runs',[])
print('NONE' if not runs else f\"{runs[0]['id']}|{runs[0]['status']}|{runs[0].get('conclusion')}\")")
  if [ "$ROW" = "NONE" ]; then
    echo "$(date +%T) run aún no registrada"; sleep 15; continue
  fi
  ID=$(cut -d'|' -f1 <<<"$ROW"); ST=$(cut -d'|' -f2 <<<"$ROW"); CON=$(cut -d'|' -f3 <<<"$ROW")
  echo "$(date +%T) run $ID: $ST ${CON:-}"
  if [ "$ST" = "completed" ]; then
    echo "FINAL=$CON"
    echo "URL: https://github.com/${REPO}/actions/runs/${ID}"
    exit $([ "$CON" = "success" ] && echo 0 || echo 1)
  fi
  sleep 20
done
echo "TIMEOUT esperando el run"; exit 2
