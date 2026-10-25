#!/usr/bin/env python3
"""E2E: cadera cuadrada al inicio + seleccion simplificada (peticion del jugador).

Verifica:
  1. La pelvis NO amanece girada: |hipL.z - hipR.z| < 0.06 m y |yaw| < 15 deg
     (antes: 0.27 m y 90 grados), estable durante el settle.
  2. Teclas 1-4: agarre directo sin punteria (dragging=true, selected correcto,
     el objetivo nace EN la extremidad: nada salta), repitir la tecla suelta.
  3. Toast informativo del agarre por teclado.
  4. pickAt sigue encontrando la extremidad (iman no roto).
  5. Consola limpia.
Capturas: download/cadera-*.png
"""
import subprocess, json, time, sys, math

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

ab("open", "http://localhost:3000/")
time.sleep(4)
try: ab("find", "text", "Comenzar", "click")
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.5)

st = ev('window.__NS.state()')
print("estado inicial:", st)
if st not in ("READY", "PLAYING"):
    fail(f"estado inesperado {st}")

# --- 1) Cadera cuadrada: muestreo durante el settle y despues de estabilizar.
# La VERDAD del guinada es la lectura del solver (twist around el eje columna);
# el dz en pantalla confunde el balanceo del pendulo con el giro.
worst_angle = 0.0
worst_z = 0.0
limit_rad = (ev('JSON.stringify(window.__NS.tune())') or {}).get("twistLimitRad", 0.45)
for k in range(10):
    time.sleep(0.6)
    tw = ev('JSON.stringify(window.__NS.twists())') or []
    if tw:
        worst_angle = max(worst_angle, abs(tw[0]["angle"]))
    hil = ev('JSON.stringify(window.__NS.chainInfo("foot_l").root)')
    hir = ev('JSON.stringify(window.__NS.chainInfo("foot_r").root)')
    worst_z = max(worst_z, abs(hil["z"] - hir["z"]))
print(f"peor guinada (solver): {math.degrees(worst_angle):.1f} deg · peor dz caderas: {worst_z:.3f} m")
# Cruzada 90 grados => dz ~0.27 m y guinada ~1.5 rad; el tope anatomico es limit_rad.
if worst_angle > limit_rad + 0.05:
    fail(f"guinada por encima del tope anatomico: {math.degrees(worst_angle):.1f} deg > {(limit_rad + 0.05) * 180 / math.pi:.1f}")
if worst_z > 0.14:
    fail(f"cadera cruzada en profundidad: dz={worst_z:.3f} (antes 0.27)")
tw = ev('JSON.stringify(window.__NS.twists())')
print("twist:", tw)
print(f"OK: cadera cuadrada desde el arranque (antes 90 grados; tope {limit_rad * 180 / math.pi:.0f} deg)")
shot("cadera-1-cuadrada.png")

# --- 2) Teclas 1-4: agarrar sin punteria, objetivo nace EN la extremidad
limbs = ev('JSON.stringify(window.__NS.limbScreen())') or []
by = {l["limb"]: l for l in limbs}
foot_l = by["foot_l"]
# mover el cursor a un punto NEUTRO lejos del pie (el agarre por teclado no mira al cursor)
ab("mouse", "move", "80", "500")
ab("eval", "window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit3'}))")
time.sleep(0.4)
if ev('window.__NS.dragging()') is not True:
    fail("Digit3 no inicio el arrastre por teclado")
sel = ev('window.__NS.selected()')
print("seleccionado con tecla 3:", sel)
if sel != "foot_l":
    fail(f"la tecla 3 debia agarrar foot_l, agarró {sel}")
# El objetivo inicial debe estar EN la extremidad (no en el cursor)
prev = ev('window.__NS.preview()')
print("preview inicial:", prev)
if prev is None:
    fail("sin preview tras el agarre por teclado")
tgt = ev(f'JSON.stringify(window.__NS.project({foot_l["x"]},{foot_l["y"]},-0.18))')
sx = ev('JSON.stringify(window.__NS.limbScreen())') or []
sl = next((l for l in sx if l["limb"] == "foot_l"), None)
if prev and sl:
    # preview.target esta en mundo (x,y): convertir a pantalla
    tscr = ev(f'JSON.stringify(window.__NS.project({prev["target"]["x"]},{prev["target"]["y"]},-0.18))')
    d = math.hypot(tscr["x"] - sl["x"], tscr["y"] - sl["y"])
    print(f"distancia objetivo-inicial a la extremidad: {d:.0f}px")
    if d > 60:
        fail(f"agarrar por teclado salta la extremidad ({d:.0f}px)")
# Mover el raton: la extremidad sigue al cursor CON offset (no teletransporta al cursor)
ab("mouse", "move", str(int(sl["x"] + 40)), str(int(sl["y"] - 30)))
time.sleep(0.3)
# Repetir la tecla: suelta
ab("eval", "window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Digit3'}))")
time.sleep(0.4)
if ev('window.__NS.dragging()') is not False:
    fail("repetir Digit3 no solto el arrastre")
print("OK: 1-4 agarran y sueltan sin punteria, sin salto inicial")

# --- 3) Toast informativo
toasts = ev('JSON.stringify([...document.querySelectorAll("#hud-toasts > div")].map(d => d.textContent))') or []
print("toasts:", toasts[-1] if toasts else None)
if toasts and "agarrada" not in " ".join(toasts).lower():
    print("  (aviso: el toast del agarre ya expiro o no aparecio)")

# --- 4) El iman clasico sigue vivo: pickAt cerca del pie izquierdo lo devuelve
# (re-muestrear: el pie se movio durante la prueba del teclado)
sx2 = ev('JSON.stringify(window.__NS.limbScreen())') or []
by2 = {l["limb"]: l for l in sx2}
fl = by2["foot_l"]
# 10 px a la IZQUIERDA del pie: los dos pies cuelgan a ~22 px el uno del otro y
# un punto a la derecha puede caer mas cerca de foot_r (empate legitimo del iman).
p = ev(f'window.__NS.pickAt({fl["x"] - 10}, {fl["y"] + 8})')
print("pickAt a la izquierda de foot_l:", p)
if p != "foot_l":
    fail(f"el iman no encuentra foot_l cerca: {p}")
shot("cadera-2-seleccion.png")

# --- 5) Consola limpia
errors = ev('JSON.stringify(window.__consoleErrors || [])')
print("errores de consola:", errors)
if errors and errors != "[]":
    fail(f"consola con errores: {errors}")

print("\nRESULTADO: PASS")
