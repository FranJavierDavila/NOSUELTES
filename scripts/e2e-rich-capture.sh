#!/bin/bash
# Espera estados concretos del ricachón y captura pantalla (salida sin escapar).
# Uso: bash scripts/e2e-rich-capture.sh <duracion_s> <prefijo>
DUR=${1:-240}
PRE=${2:-cap}
declare -A seen
end=$((SECONDS + DUR))
while [ $SECONDS -lt $end ]; do
  raw=$(agent-browser eval "JSON.parse(document.querySelector('[data-probe]')?.getAttribute('data-probe')||'{\"rich\":{}}').rich.state" 2>/dev/null | tr -d '"' | tr -d '\n')
  echo "[$SECONDS s] $raw"
  case "$raw" in
    de_pie|caminando|aplaudiendo|brindando|mirando|comiendo|dormitando)
      if [ -z "${seen[$raw]}" ]; then
        seen[$raw]=1
        f="/home/z/my-project/scripts/${PRE}-${raw}.png"
        agent-browser screenshot "$f" >/dev/null 2>&1
        echo "  >>> CAPTURA $raw -> $f"
      fi
      ;;
  esac
  sleep 2
done
echo "---VISTOS---"; for k in "${!seen[@]}"; do echo "$k"; done | sort | tr '\n' ' '; echo
