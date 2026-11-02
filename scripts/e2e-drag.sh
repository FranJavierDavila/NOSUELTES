#!/bin/bash
# Prueba E2E del prototipo NO SUELTES: arrastre de extremidad a presa.
set -u
cd /home/z/my-project

json_field() {
  # json_field <json> <key>: soporta salida doble-escapada de agent-browser eval
  python3 -c "
import json,sys
raw = sys.argv[1]
for attempt in range(3):
    try:
        d = json.loads(raw)
        if isinstance(d, str):
            raw = d
            continue
        v = d.get(sys.argv[2])
        print(v if v is not None else '')
        break
    except Exception:
        print('')
        break
" "$1" "$2"
}

ab() { agent-browser "$@" 2>/dev/null; }

echo "== estado inicial =="
ST=$(ab eval 'JSON.stringify(window.__NS ? {st: window.__NS.state(), f: window.__NS.frames()} : null)')
echo "$ST"
if [ "$(json_field "$ST" st)" != "READY" ] && [ "$(json_field "$ST" st)" != "PLAYING" ]; then
  echo "Estado no jugable: $(json_field "$ST" st)"
  exit 1
fi

HAND=$(ab eval 'JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="hand_r"))')
HX=$(json_field "$HAND" x); HY=$(json_field "$HAND" y)
TGT=$(ab eval 'JSON.stringify(window.__NS.project(0.34,1.98,-0.18))')
TX=$(json_field "$TGT" x); TY=$(json_field "$TGT" y)
echo "hand_r=($HX,$HY) -> r2=($TX,$TY)"

echo "== pick en la mano =="
ab eval "JSON.stringify(window.__NS.pickAt($HX,$HY))"

echo "== arrastre =="
ab mouse move "$HX" "$HY"
ab mouse down left
sleep 0.4
ab eval 'JSON.stringify({sel:window.__NS.selected(), drag:window.__NS.dragging(), st:window.__NS.state()})'
MX=$(( (HX+TX)/2 )); MY=$(( (HY+TY)/2 ))
ab mouse move "$MX" "$MY"
ab mouse move "$TX" "$TY"
sleep 0.5
ab screenshot download/e2e-4-drag.png
ab mouse up left
sleep 2.5

echo "== estado tras soltar =="
ab eval 'JSON.stringify({st:window.__NS.state(), sel:window.__NS.selected()})'
ab screenshot download/e2e-5-postdrop.png
echo "== fin =="
