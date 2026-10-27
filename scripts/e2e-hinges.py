#!/usr/bin/env python3
"""E2E de BISAGRAS en produccion: carga una prueba, espera el settle y comprueba
que las 4 bisagras (codos/rodillas) estan expuestas y bajo tolerancia en colgado
tranquilo. Complemento del sanity fisico para la peticion "articulaciones no
rotas"."""
import json, time, sys

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    for _ in range(3):
        try:
            d = json.loads(raw)
        except Exception:
            return None
        if isinstance(d, str) and (d.startswith('"') or d.startswith('{') or d.startswith('[')):
            raw = d
            continue
        return d
    return None

import subprocess
import e2e_lib as lib

ok = True
fallos = []

ab("open", "http://localhost:3000/")
time.sleep(4)
lib.enter(ab)
time.sleep(2.0)
ab("eval", "document.getElementById('tut-skip')?.click()")
time.sleep(1.0)
ab("eval", "window.__NS.load('circuit_stage_1')")
time.sleep(5.0)

estado = ev("window.__NS.state()")
print("estado:", estado)

bisagras = ev("JSON.stringify(window.__NS.hinges())")
if isinstance(bisagras, str):
    bisagras = json.loads(bisagras)
print("bisagras:", bisagras)
if not isinstance(bisagras, list) or len(bisagras) != 4:
    ok = False
    fallos.append(f"bisagras inesperadas: {bisagras}")
else:
    ids = {h["id"] for h in bisagras}
    if ids != {"hinge_elbow_l", "hinge_elbow_r", "hinge_knee_l", "hinge_knee_r"}:
        ok = False
        fallos.append(f"ids de bisagra incorrectos: {ids}")
    for h in bisagras:
        dentro = h["dev"] <= h["tol"] + 0.01
        print(f"  {h['id']}: dev={h['dev']:.3f} tol={h['tol']:.3f} -> {'OK' if dentro else 'FUERA'}")
        if not dentro:
            ok = False
            fallos.append(f"{h['id']} fuera de tolerancia")

estado2 = ev("window.__NS.state()")
print("estado final:", estado2)
if estado2 not in ("READY", "PLAYING"):
    ok = False
    fallos.append(f"estado final {estado2}")

ab("screenshot", "/home/z/my-project/download/hinges-sanity.png")
print("RESULTADO:", "PASS" if ok else f"FAIL {fallos}")
sys.exit(0 if ok else 1)
