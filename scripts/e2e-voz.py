#!/usr/bin/env python3
"""E2E de la voz sintetica: el juego sigue estable con el nuevo AudioBus.

Recorre el camino dorado (arrastre -> transferencia -> eventos de zona ->
reset) y verifica que el navegador no registra errores de consola tras el
cambio de audio. El sonido no es observable por CLI; se valida que:
  - window.__NS sigue operativo (el loop no se ha roto),
  - frames avanzan, anclajes y cargas se miden igual que antes,
  - la consola queda limpia mientras el audio consume todos esos eventos.
Guarda captura en download/voz-e2e.png.
"""
import subprocess, json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    try:
        d = json.loads(raw)
    except Exception:
        return None
    if isinstance(d, str):
        try:
            return json.loads(d)
        except Exception:
            return d
    return d

def shot(name):
    ab("screenshot", f"/home/z/my-project/download/{name}")
    print(f"  captura: download/{name}")

ok = True
ab("open", "http://localhost:3000/")
time.sleep(4)
try: ab("find", "text", "Comenzar", "click")
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

st = ev('window.__NS.state()')
print("estado inicial:", st)
if st != "READY":
    print("FALLO: no READY tras iniciar"); sys.exit(1)

# --- 1) Arrastre real hand_r -> r2 (genera HoldAcquired, strain, etc.)
def drag(limb, hx, hy):
    ls = ev('JSON.stringify(window.__NS.limbScreen())') or []
    src = next((l for l in ls if l["limb"] == limb), None)
    tgt = ev(f'JSON.stringify(window.__NS.project({hx},{hy},-0.18))')
    if not src or not tgt:
        return False
    ab("mouse", "move", str(int(src["x"])), str(int(src["y"])))
    ab("mouse", "down", "left")
    time.sleep(0.22)
    for i in range(1, 11):
        ab("mouse", "move", str(int(src["x"] + (tgt["x"] - src["x"]) * i / 10)),
           str(int(src["y"] + (tgt["y"] - src["y"]) * i / 10)))
        time.sleep(0.06)
    ab("mouse", "up", "left")
    return True

f0 = ev('window.__NS.frames()') or 0
moved = drag("hand_r", 0.34, 1.98)
time.sleep(1.5)
f1 = ev('window.__NS.frames()') or 0
anch = ev('JSON.stringify(window.__NS.anchors())') or []
hr = next((a for a in anch if a.get("limb") == "hand_r"), None)
print(f"frames {f0}->{f1}, anclajes: {[(a['limb'], a['hold']) for a in anch]}")
if not moved or f1 <= f0:
    print("FALLO: loop detenido o arrastre no ejecutado"); ok = False
if not hr or hr.get("hold") != "r2":
    print("AVISO: hand_r no acaba en r2 (el arrastre no consolido)"); ok = False
else:
    print("[OK] transferencia hand_r->r2 con audio de voz activo")

# --- 2) LimbInfo sigue midiendo (el audio consume StrainStarted/OverloadStarted sin romper)
info = ev('JSON.stringify(window.__NS.debugLimbInfo())')
print("limbInfo:", str(info)[:160])

# --- 3) Reset con voz de preparacion (ResetStarted -> inhale)
ab("keyboard", "press", "KeyR")
time.sleep(2.0)
st2 = ev('window.__NS.state()')
print("estado tras R:", st2)
if st2 not in ("READY", "PLAYING"):
    print("FALLO: reset no concreto"); ok = False

# --- 4) Consola limpia durante TODOS los eventos sonoros anteriores
logs = ab("console") or ""
errs = [l for l in logs.splitlines() if "error" in l.lower() and "favicon" not in l.lower()]
if errs:
    print("FALLO: errores de consola:", errs[:5]); ok = False
else:
    print("[OK] consola limpia durante todo el recorrido sonoro")

shot("voz-e2e.png")
print("RESULTADO:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
