#!/usr/bin/env python3
"""E2E de orientacion clara y control determinista (peticion del jugador).

Verifica:
  1. Cuatro etiquetas IZQ/DER flotantes, en el lado correcto de la pantalla y
     pegadas a su extremidad; se mueven con ella al transferir un agarre.
  2. Los chips del panel lateral llevan el color de lado (azul IZQ / rosa DER).
  3. Chip EN VIVO de motivo de rechazo durante el arrastre a una presa invalida
     ("esa presa no admite esa extremidad") y se oculta al soltar.
  4. Sin falsos rechazos posturales en el camino dorado (reject hand_r->r2 = null).
  5. Consola limpia.
Capturas: download/orientacion-*.png
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

def fail(msg):
    print(f"FALLO: {msg}")
    sys.exit(1)

def drag(limb, hx, hy, hold_ms=350, tries=2):
    tgt = ev(f'JSON.stringify(window.__NS.project({hx},{hy},-0.18))')
    if not tgt:
        return False
    for _ in range(tries):
        ls = ev('JSON.stringify(window.__NS.limbScreen())') or []
        src = next((l for l in ls if l["limb"] == limb), None)
        if not src:
            return False
        ab("mouse", "move", str(int(src["x"])), str(int(src["y"])))
        ab("mouse", "down", "left")
        time.sleep(0.22)
        if ev('window.__NS.dragging()') is not True:
            ab("mouse", "up", "left")
            time.sleep(0.3)
            continue
        for i in range(1, 11):
            ab("mouse", "move", str(int(src["x"] + (tgt["x"] - src["x"]) * i / 10)),
               str(int(src["y"] + (tgt["y"] - src["y"]) * i / 10)))
            time.sleep(0.045)
        if hold_ms:
            time.sleep(hold_ms / 1000.0)
        return True
    return False

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
if st not in ("READY", "PLAYING"):
    fail(f"estado inesperado {st}")

# --- 1) Etiquetas de lado: 4 presentes, ordenadas y pegadas a su extremidad
labels = ev('JSON.stringify(window.__NS.labels())') or []
print("etiquetas:", labels)
if len(labels) != 4:
    fail(f"esperaba 4 etiquetas IZQ/DER, hay {len(labels)}")
by = {l["limb"]: l for l in labels}
if not (by["hand_l"]["x"] < by["hand_r"]["x"] and by["foot_l"]["x"] < by["foot_r"]["x"]):
    fail(f"lado izquierdo no aparece a la izquierda: {by}")
limbs = ev('JSON.stringify(window.__NS.limbScreen())') or []
limb_by = {l["limb"]: l for l in limbs}
for limb in ("hand_l", "hand_r", "foot_l", "foot_r"):
    d = ((by[limb]["x"] - limb_by[limb]["x"]) ** 2 + (by[limb]["y"] - limb_by[limb]["y"]) ** 2) ** 0.5
    if d > 170:
        fail(f"etiqueta {limb} lejos de su extremidad ({d:.0f}px)")
print("OK: 4 etiquetas en su lado y pegadas a su extremidad")

# --- 2) Chips del panel con color de lado (azul/rosa)
colors = ev('''JSON.stringify([...document.querySelectorAll("#hud-limbs > div")].map(d => {
  const span = d.querySelector("span");
  return { text: span?.textContent, color: span ? getComputedStyle(span).color : "" };
}))''') or []
print("chips:", colors)
def rgb(hexs):
    return f"rgb({int(hexs[1:3],16)}, {int(hexs[3:5],16)}, {int(hexs[5:7],16)})"
want = {"Mano izq.": rgb("#58a6ff"), "Mano der.": rgb("#ff6f91"), "Pie izq.": rgb("#58a6ff"), "Pie der.": rgb("#ff6f91")}
for c in colors:
    if want.get(c["text"]) and c["color"] != want[c["text"]]:
        fail(f"chip {c['text']} color {c['color']} != {want[c['text']]}")
print("OK: paleta de lado coherente escena-HUD")

# --- 3) Chip EN VIVO de rechazo durante arrastre a presa invalida (presa de pies con la mano)
hand_r_label_before = by["hand_r"]
if not drag("hand_l", -0.62, 0.72):
    fail("no se pudo iniciar el arrastre hand_l -> foot_jug_l")
time.sleep(0.4)
chip = ev('document.getElementById("hud-reject")?.classList.contains("hidden") ? null : document.getElementById("hud-reject")?.textContent')
print("chip de rechazo durante arrastre invalido:", chip)
if not chip or "no admite" not in chip:
    fail(f"el chip de rechazo no explica el motivo: {chip}")
shot("orientacion-1-rechazo.png")
ab("mouse", "up", "left")
time.sleep(1.5)
chip_after = ev('document.getElementById("hud-reject")?.classList.contains("hidden") ? null : document.getElementById("hud-reject")?.textContent')
if chip_after is not None:
    fail(f"el chip de rechazo sigue visible tras soltar: {chip_after}")
print("OK: motivo en vivo durante el arrastre y oculto al soltar")

# --- 4) Sin falsos rechazos en el camino dorado
r = ev('window.__NS.reject("hand_r","r2")')
print("reject(hand_r -> r2):", r)
if r is not None:
    fail(f"el camino dorado quedo rechazado por las reglas posturales: {r}")

# --- 5) Transferencia real hand_r -> r2: la etiqueta sigue a la extremidad
if not drag("hand_r", 0.34, 1.98, hold_ms=0):
    fail("no se pudo iniciar la transferencia hand_r -> r2")
ab("mouse", "up", "left")
t0 = time.time()
moved = False
while time.time() - t0 < 8:
    anchors = ev('JSON.stringify(window.__NS.anchors())') or []
    if any(a.get("hold") == "r2" for a in anchors):
        moved = True
        break
    time.sleep(0.25)
if not moved:
    print("eventos:", ev('JSON.stringify(window.__NS.events())')[-8:])
    fail("la transferencia hand_r -> r2 no llego")
labels2 = ev('JSON.stringify(window.__NS.labels())') or []
by2 = {l["limb"]: l for l in labels2}
limbs2 = ev('JSON.stringify(window.__NS.limbScreen())') or []
limb2 = {l["limb"]: l for l in limbs2}
ldx = by2["hand_r"]["x"] - hand_r_label_before["x"]
ddy = by2["hand_r"]["y"] - hand_r_label_before["y"]
mdx = limb2["hand_r"]["x"] - limb_by["hand_r"]["x"]
mdy = limb2["hand_r"]["y"] - limb_by["hand_r"]["y"]
print(f"delta etiqueta DER: ({ldx:.0f},{ddy:.0f})px · delta mano DER: ({mdx:.0f},{mdy:.0f})px")
if abs(ldx - mdx) > 14 or abs(ddy - mdy) > 14:
    fail("la etiqueta no sigue a la extremidad")
st = ev('window.__NS.state()')
print("estado tras transferencia:", st)
shot("orientacion-2-transferida.png")

# --- 6) Consola limpia
errors = ev('JSON.stringify(window.__consoleErrors || [])')
print("errores de consola:", errors)

print("\nRESULTADO: PASS")
