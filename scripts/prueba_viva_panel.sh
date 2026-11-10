#!/usr/bin/env bash
# Prueba en vivo del panel (T119): raíz → nivel PARED con ?dev=1 → panel visible
set -u
D=/home/z/my-project/download/T119-como-se-ve
mkdir -p "$D"

agent-browser open "https://franjavierdavila.github.io/NOSUELTES/?nivel=pared&dev=1" --timeout 60000 2>&1 | tail -1
sleep 50
R=$(agent-browser eval "JSON.stringify({panel: !!document.getElementById('pared-panel'), sliders: document.querySelectorAll('#pared-panel input[type=range]').length, canvas: !!document.querySelector('canvas')})" 2>&1 | tail -1)
echo "chequeo 50s: $R"
case "$R" in
  *'"panel":true'*) : ;;
  *) sleep 25
     R=$(agent-browser eval "JSON.stringify({panel: !!document.getElementById('pared-panel'), sliders: document.querySelectorAll('#pared-panel input[type=range]').length})" 2>&1 | tail -1)
     echo "chequeo 75s: $R" ;;
esac
agent-browser screenshot "$D/03-panel-ahora.png" 2>&1 | tail -1
agent-browser close 2>&1 | tail -1
python3 -c "from PIL import Image; im=Image.open('$D/03-panel-ahora.png').convert('L'); h=im.histogram(); print(im.size, 'ratio no-blanco %.2f' % (1-h[255]/sum(h)))"
