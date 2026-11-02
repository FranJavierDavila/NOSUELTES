#!/usr/bin/env python3
"""E2E de fisica muscular ADR-007 en navegador: iman de picking, apoyo de pie que
levanta el cuerpo (descarga de brazos) y estabilidad sin ERROR GUARD."""
import subprocess, json, time

def ab(*args):
    r = subprocess.run(["agent-browser", *args], capture_output=True, text=True)
    return r.stdout.strip()

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

def screen(limb):
    return ev(f'JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="{limb}"))')

def project(x, y, z):
    return ev(f'JSON.stringify(window.__NS.project({x},{y},{z}))')

def hip_y():
    return ev('window.__NS.chainInfo("foot_l").root.y')

print("== 0. abrir y empezar ==")
ab("open", "http://localhost:3000/")
time.sleep(4)
import e2e_lib as lib
lib.enter(ab)
time.sleep(1.0)
try:
    ab("find", "text", "Saltar tutorial", "click")
except Exception:
    pass
time.sleep(1.5)
print("estado:", ev('JSON.stringify(window.__NS.state())'))

print("== 1. iman de picking (offset 42 px del pie) ==")
foot = screen("foot_l")
px, py = foot["x"] + 42, foot["y"] + 18
pick = ev(f'window.__NS.pickAt({px},{py})')
print(f"foot_l en ({foot['x']},{foot['y']}); clic a +42px -> pickAt={pick} (esperado foot_l)")

print("== 2. apoyo de pie bajo (foot_jug_l): el cuerpo debe ascender ==")
hip0 = hip_y()
jug = project(-0.62, 0.72, -0.18)
print(f"cadera y={hip0:.3f} -> arrastre foot_l ({foot['x']},{foot['y']}) -> jug ({jug['x']},{jug['y']})")
ab("mouse", "move", str(int(foot["x"])), str(int(foot["y"])))
ab("mouse", "down", "left")
time.sleep(0.25)
for i in range(1, 11):
    ab("mouse", "move", str(int(foot["x"] + (jug["x"] - foot["x"]) * i / 10)), str(int(foot["y"] + (jug["y"] - foot["y"]) * i / 10)))
    time.sleep(0.08)
ab("mouse", "up", "left")
time.sleep(3.0)
hip1 = hip_y()
anch = ev('JSON.stringify(window.__NS.anchors())')
print(f"cadera y={hip0:.3f} -> {hip1:.3f} (delta {hip1-hip0:+.3f} m)")
print("anclajes:", anch)
print("estado:", ev('JSON.stringify(window.__NS.state())'))
ab("screenshot", "download/musculos-apoyo-pie.png")

print("== 3. step-up: pie a presa alta r1 (montar escalon) ==")
foot = screen("foot_l")
r1 = project(-0.18, 1.62, -0.18)
chest0 = ev('window.__NS.chainInfo("hand_l").root.y')
ab("mouse", "move", str(int(foot["x"])), str(int(foot["y"])))
ab("mouse", "down", "left")
time.sleep(0.25)
for i in range(1, 11):
    ab("mouse", "move", str(int(foot["x"] + (r1["x"] - foot["x"]) * i / 10)), str(int(foot["y"] + (r1["y"] - foot["y"]) * i / 10)))
    time.sleep(0.08)
ab("mouse", "up", "left")
time.sleep(3.5)
hip2 = hip_y()
chest1 = ev('window.__NS.chainInfo("hand_l").root.y')
anch = ev('JSON.stringify(window.__NS.anchors())')
print(f"hombro y={chest0:.3f} -> {chest1:.3f} (delta {chest1-chest0:+.3f} m) | cadera y={hip2:.3f}")
print("anclajes:", anch)
print("estado:", ev('JSON.stringify(window.__NS.state())'))
ab("screenshot", "download/musculos-stepup.png")

print("== 4. transferencia de mano (flujo general intacto) ==")
hand = screen("hand_r")
r2 = project(0.34, 1.98, -0.18)
ab("mouse", "move", str(int(hand["x"])), str(int(hand["y"])))
ab("mouse", "down", "left")
time.sleep(0.25)
for i in range(1, 11):
    ab("mouse", "move", str(int(hand["x"] + (r2["x"] - hand["x"]) * i / 10)), str(int(hand["y"] + (r2["y"] - hand["y"]) * i / 10)))
    time.sleep(0.08)
ab("mouse", "up", "left")
time.sleep(2.5)
print("anclajes:", ev('JSON.stringify(window.__NS.anchors())'))
print("estado:", ev('JSON.stringify(window.__NS.state())'))

print("== 5. reset R idempotente ==")
ab("press", "r")
time.sleep(2.0)
print("estado:", ev('JSON.stringify(window.__NS.state())'))
print("anclajes:", ev('JSON.stringify(window.__NS.anchors())'))
ab("screenshot", "download/musculos-reset.png")
print("OK")
