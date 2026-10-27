#!/bin/bash
# Sondea la sonda data-probe del ricachón y captura pantallas de estados nuevos.
# Uso: bash scripts/e2e-rich-states.sh <duracion_s> <intervalo_s> <prefijo>
DUR=${1:-200}
IV=${2:-8}
PRE=${3:-rich}
declare -A seen
end=$((SECONDS + DUR))
i=0
while [ $SECONDS -lt $end ]; do
  out=$(agent-browser eval "JSON.stringify(JSON.parse(document.querySelector('[data-probe]')?.getAttribute('data-probe')||'{}').rich||{})" 2>/dev/null | tr -d '\n')
  echo "[$SECONDS s] $out"
  # estados de interés para captura
  for st in de_pie caminando aplaudiendo brindando mirando comiendo dormitando insultando pataleando; do
    if echo "$out" | rg -q "\"state\":\"$st\"" && [ -z "${seen[$st]}" ]; then
      seen[$st]=1
      f="/home/z/my-project/scripts/${PRE}-${st}.png"
      agent-browser screenshot "$f" >/dev/null 2>&1
      echo "  >>> CAPTURA $st -> $f"
    fi
  done
  sleep "$IV"
  i=$((i+1))
done
echo "---VISTOS---"
for k in "${!seen[@]}"; do echo "$k"; done | sort | tr '\n' ' '; echo
