#!/usr/bin/env python3
"""E2E de la REGLA DE LOSA (peticion del jugador: de pie sin manos solo si la
inclinacion de la pared lo permite fisicamente). Escenario 1 (LA PLACA, 18 deg):
anclar ambos pies en las presas de pie, soltar las manos -> el cuerpo DEBE seguir
en PLAYING (de pie, legal). En pared vertical (ETAPA 1 campeonato) con el mismo
procedimiento forzado boca abajo el cuerpo SI cae (cubierto por e2e-circuito
via forceProne). Aqui se valida el caso POSITIVO de losa."""
import subprocess, json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    for _ in range(3):
        try:
            d = json.loads(raw)
        except Exception:
            return None
        # Un string plano ("PLAYING") es el resultado final: no se re-parsea
        # (json.loads("PLAYING") falla y devolvia None: el famoso "flake").
        if isinstance(d, str) and (d.startswith('"') or d.startswith('{') or d.startswith('[')):
            raw = d
            continue
        return d
    return None

ok = True
fallos = []

ab("open", "http://localhost:3000/")
time.sleep(4)
import e2e_lib as lib
lib.enter(ab)
time.sleep(2.0)
ab("eval", "document.getElementById('tut-skip')?.click()")
time.sleep(1.0)
ab("eval", "window.__NS.load('circuit_stage_1')")
time.sleep(4.5)

# Presas del SEGMENTO INCLINADO (placa, y > 2.2 m): fa1/fb1 estan en el tramo
# vertical inferior; para estar de pie hay que apoyar los pies en la placa.
FOOT_TARGETS = {"foot_l": (0.23, 2.303), "foot_r": (-0.25, 2.588)}

def state_retry():
    for _ in range(6):
        v = ev('JSON.stringify(window.__NS.state())')
        if v is not None:
            return v
        time.sleep(0.7)
    return None

def drag(limb, hx, hy):
    for intento in range(3):
        ev('window.__NS.relieve()')
        ls = ev('JSON.stringify(window.__NS.limbScreen())') or []
        src = next((l for l in ls if l["limb"] == limb), None)
        tgt = ev(f'JSON.stringify(window.__NS.project({hx},{hy},-0.18))')
        if not src or not tgt:
            time.sleep(0.8); continue
        ab("mouse", "move", str(int(src["x"])), str(int(src["y"])))
        ab("mouse", "down", "left")
        time.sleep(0.22)
        for i in range(1, 11):
            ab("mouse", "move", str(int(src["x"] + (tgt["x"] - src["x"]) * i / 10)),
               str(int(src["y"] + (tgt["y"] - src["y"]) * i / 10)))
            time.sleep(0.06)
        ab("mouse", "up", "left")
        time.sleep(2.2)
        anch = ev('JSON.stringify(window.__NS.anchors())') or []
        if any(a["limb"] == limb and a["hold"] in ("h1", "h2", "h3", "h4", "h5", "h6") for a in anch):
            return True
    return False

print("== fixture forceSlabStand: de pie en la placa sin manos ==")
placed = ev('JSON.stringify(window.__NS.forceSlabStand())')
print("forceSlabStand ->", placed)
# Pasar a PLAYING (doble grab libera la mano sin anclar: beginDrag transiciona).
ev('window.__NS.grab("hand_r")')
time.sleep(0.6)
ev('window.__NS.grab("hand_r")')
time.sleep(0.8)
print("estado tras doble grab:", ev('window.__NS.state()'))
okl = okr = False
if placed not in (True, "true"):
    # Fallback organico: arrastrar pies a presas de la placa.
    okl = drag("foot_l", *FOOT_TARGETS["foot_l"])
    okr = drag("foot_r", *FOOT_TARGETS["foot_r"])
    print(f"organico foot_l={okl} foot_r={okr}")
    if not (okl and okr):
        fallos.append("no se pudo colocar el cuerpo de pie en la placa")
if placed in (True, "true") or (okl and okr):
    st = state_retry()
    print("estado con pies + manos:", st)
    # Soltar ambas manos: en la LOSA el cuerpo se queda DE PIE (legal).
    ev('window.__NS.releaseLimb("hand_l")')
    ev('window.__NS.releaseLimb("hand_r")')
    time.sleep(1.0)
    postura = ev('JSON.stringify(window.__NS.posture())')
    print("postura sin manos:", postura)
    time.sleep(2.0)
    st2 = state_retry()
    print("estado 3 s sin manos:", st2)
    if st2 == "FALLEN":
        fallos.append("en LOSA el cuerpo cayo sin manos (deberia estar de pie)")
    elif st2 != "PLAYING":
        fallos.append(f"estado inesperado sin manos en losa: {st2}")
    else:
        print("[OK] de pie en la placa sin manos: fisica creible")

logs = ab("console") or ""
errs = [l for l in logs.splitlines() if "error" in l.lower() and "favicon" not in l.lower()]
if errs:
    fallos.append(f"errores de consola: {errs[:3]}")

ab("screenshot", "download/losa-de-pie.png")
print("RESULTADO:", "PASS" if not fallos else "FAIL")
for f in fallos:
    print("  FALLO:", f)
sys.exit(0 if not fallos else 1)
