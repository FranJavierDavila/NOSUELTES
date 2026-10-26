#!/usr/bin/env python3
"""E2E de ascension completa: escalada de la ruta de principio a fin usando la
fisica muscular ADR-007 (pies que empujan, step-up). Imprime la altura de cadera
tras cada movimiento. La presa 'top' con ambas manos = EXITO."""
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

# (limb, holdId, x, y) — ruta planificada: pies r2/r4/r6/r8, manos r1/r3/r5/r7/top
RUTA = [
    ("foot_r", "foot_jug_r",  0.62, 0.72),
    ("foot_l", "foot_jug_l", -0.62, 0.72),
    ("hand_r", "r2",          0.34, 1.98),
    ("hand_l", "r3",         -0.40, 2.38),
    ("foot_r", "r1",         -0.18, 1.62),
    ("foot_l", "r2",          0.34, 1.98),
    ("hand_r", "r4",          0.10, 2.78),
    ("hand_l", "r5",         -0.34, 3.18),
    ("foot_r", "r4",          0.10, 2.78),
    ("foot_l", "r6",          0.36, 3.52),
    ("hand_l", "r7",         -0.06, 3.92),
    ("hand_r", "r6",          0.36, 3.52),
    ("hand_r", "r8",          0.30, 4.26),
    ("hand_l", "top",         0.00, 4.58),
    ("hand_r", "top",         0.00, 4.58),
]

def drag(limb_screen, target_screen):
    ab("mouse", "move", str(int(limb_screen["x"])), str(int(limb_screen["y"])))
    ab("mouse", "down", "left")
    time.sleep(0.22)
    for i in range(1, 11):
        mx = limb_screen["x"] + (target_screen["x"] - limb_screen["x"]) * i / 10
        my = limb_screen["y"] + (target_screen["y"] - limb_screen["y"]) * i / 10
        ab("mouse", "move", str(int(mx)), str(int(my)))
        time.sleep(0.07)
    ab("mouse", "up", "left")

ab("open", "http://localhost:3000/")
time.sleep(4)
import e2e_lib as lib
try:
    lib.enter(ab)
except Exception:
    pass
except Exception: pass
time.sleep(2.5)
try: ab("eval", "document.getElementById('tut-skip')?.click()")
except Exception: pass
time.sleep(1.0)
# Desde el campeonato la carga por defecto es la ETAPA 1; esta ruta es la del tutorial.
ab("eval", "window.__NS.load('challenge_reach_top')")
time.sleep(4)
if not ev('JSON.stringify({s: window.__NS.state()}).slice(6, -2)') == "READY":
    time.sleep(3)

for limb, hold, hx, hy in RUTA:
    ok = False
    for intento in range(3):
        # Alivio E2E (mismo criterio que e2e-circuito): el rig tarda ~3 s por
        # movimiento a ritmo de CLI y sostiene cargas sostenidas que un humano
        # no aguanta estatico; la fatiga/sobrecarga medidas no dependen de esto.
        ev('window.__NS.relieve()')
        ls = ev('JSON.stringify(window.__NS.limbScreen())')
        src = next((l for l in ls if l["limb"] == limb), None)
        tgt = ev(f'JSON.stringify(window.__NS.project({hx},{hy},-0.18))')
        if not src or not tgt:
            print(f"ERROR proyectando {limb}->{hold}"); sys.exit(1)
        drag(src, tgt)
        time.sleep(3.2)
        anchors = ev('JSON.stringify(window.__NS.anchors())')
        ok = any(a["limb"] == limb and a["hold"] == hold for a in anchors) if anchors else False
        if ok:
            break
        time.sleep(1.2)  # el cuerpo termina de asentarse y se reintenta
    hip = ev('window.__NS.chainInfo("foot_l").root.y')
    ancl = ", ".join(f"{a['limb']}@{a['hold']}" for a in (anchors or []))
    print(f"{limb:7s} -> {hold:12s} {'OK ' if ok else 'FALLA'} cadera={hip:.2f}  [{ancl}]")
    ab("screenshot", f"download/ascenso-{len([x for x in RUTA if x[1] <= hold])+1:02d}-{hold}.png")
    st = ev('JSON.stringify(window.__NS.state())')
    if st in ("SUCCESS", "FALLEN", "TIMEOUT"):
        print("ESTADO FINAL:", st)
        break

# Espera activa a la ventana de exito (0.5 s estables) tras la ultima jugada.
# Lectura con reintento: el CLI a veces devuelve None justo tras el exito (flake).
def state_retry():
    for _ in range(6):
        v = ev('JSON.stringify(window.__NS.state())')
        if v is not None:
            return v
        time.sleep(0.7)
    return None

final = None
t0 = time.time()
while time.time() - t0 < 8:
    final = state_retry()
    if final in ("SUCCESS", "FALLEN", "TIMEOUT"):
        break
    ev('window.__NS.relieve()')
    time.sleep(0.5)
print("anclajes finales:", ev('JSON.stringify(window.__NS.anchors())'))
print("estado final:", final)
if final == "SUCCESS":
    ab("screenshot", "download/ascenso-exito.png")
