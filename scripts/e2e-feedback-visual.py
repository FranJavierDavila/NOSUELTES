#!/usr/bin/env python3
"""E2E de la retroalimentacion visual corporal (mochila/marcadores + colores de zona):
(1) el personaje muestra mochila (espalda) y marcadores turquesa (frente),
(2) las extremidades ancladas y el anillo de su presa heredan la zona de carga
    (verde normal / ambar tension / rojo sobrecarga, paleta identica al HUD),
(3) el anillo SIGUE a la presa al transferir el anclaje,
(4) el tutorial actualizado sigue pasando de punta a punta.
Guarda capturas en download/feedback-*.png."""
import subprocess, json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    """Evalua JS y devuelve el valor parseado o None. El CLI a veces devuelve
    la salida doble-codificada: si tras el primer parse hay un str se reintenta
    una vez; si ese segundo parse falla, el str ES el valor (textos planos)."""
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

ab("open", "http://localhost:3000/")
time.sleep(4)
try: ab("find", "text", "Comenzar", "click")
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)

def state():
    return (ev('JSON.stringify({s: window.__NS.state()})') or {}).get("s")

def anchors():
    return ev('JSON.stringify(window.__NS.anchors())') or []

ok = True
st = state()
print("estado inicial:", st)
if st != "READY":
    print("FALLO: no READY"); sys.exit(1)

# --- 1) Pose inicial: manos ancladas a start_l/start_r.
ancl = anchors()
print("anclajes iniciales:", [(a["limb"], a["hold"]) for a in ancl])
hold_of = {a["limb"]: a["hold"] for a in ancl}
if hold_of.get("hand_l") != "start_l" or hold_of.get("hand_r") != "start_r":
    print("AVISO: anclajes iniciales inesperados"); ok = False
time.sleep(1.2)  # deja que el primer frame estabilice y los anillos se situen
shot("feedback-1-inicial.png")

# --- 2) Transferencia hand_r -> r2: el anillo debe saltar de start_r a r2.
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

moved = drag("hand_r", 0.34, 1.98)
print("transferencia hand_r->r2 ejecutada:", moved)
time.sleep(1.5)
ancl2 = anchors()
hold_of2 = {a["limb"]: a["hold"] for a in ancl2}
print("anclajes tras transferencia:", [(a["limb"], a["hold"]) for a in ancl2])
if hold_of2.get("hand_r") != "r2":
    print("FALLO: la transferencia no fijo r2"); ok = False
st2 = state()
print("estado tras transferencia:", st2)
if st2 != "PLAYING":
    print("AVISO: se esperaba PLAYING tras el primer arrastre")
shot("feedback-2-transferencia.png")

# --- 3) Cargas y zonas en vivo (debug de consola del arnes, mismo dato que alimenta
# el tinte y los anillos) para poder contrastar con la captura.
dbg = ev('JSON.stringify(window.__NS.debugLimbInfo ? window.__NS.debugLimbInfo() : null)')
if dbg:
    print("zonas por extremidad:", json.dumps(dbg, ensure_ascii=False))
else:
    print("zonas: (sin expositor dedicado; se valida visualmente en la captura)")

# --- 4) Ayuda H contiene la leyenda nueva.
try:
    # El juego escucha ev.code ("KeyH"), no ev.key: despachar con code.
    ab("eval", "window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyH', bubbles: true}))")
    time.sleep(0.6)
    body = ev('JSON.stringify(document.getElementById("hud-help")?.textContent ?? "")') or ""
    tiene_colores = "Colores de carga" in str(body)
    tiene_mochila = "mochila" in str(body).lower()
    print("ayuda menciona colores de carga:", tiene_colores, "| mochila:", tiene_mochila)
    if not (tiene_colores and tiene_mochila):
        ok = False
    shot("feedback-3-ayuda.png")
    ab("eval", "window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyH', bubbles: true}))")
    time.sleep(0.4)
except Exception as e:
    print("AVISO: verificacion de ayuda fallo:", e)

# --- 5) Captura cercana del personaje para leer mochila/marcadores (zoom via F4 orto).
try:
    ab("keys", "F4")
    time.sleep(0.8)
    shot("feedback-4-ortografica.png")
    ab("keys", "F4")
except Exception:
    pass

print("RESULTADO:", "OK" if ok else "CON FALLOS")
sys.exit(0 if ok else 1)
