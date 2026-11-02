#!/usr/bin/env python3
"""E2E del prototipo NO SUELTES: transferencia de anclaje, reset, cambio de desafio."""
import subprocess, json, time, sys

def ab(*args):
    r = subprocess.run(["agent-browser", *args], capture_output=True, text=True)
    return r.stdout.strip()

def field(raw, key):
    for _ in range(3):
        try:
            d = json.loads(raw)
            if isinstance(d, str):
                raw = d; continue
            return d.get(key)
        except Exception:
            return None
    return None

def ev(js):
    return ab("eval", js)

def anchors():
    return {a["limb"]: a["hold"] for a in (field(ev("JSON.stringify(window.__NS.anchors())"), "dummy") or [])} if False else ev("JSON.stringify(window.__NS.anchors())")

print("== 0. estado ==")
print(ev('JSON.stringify({st:window.__NS.state(),f:window.__NS.frames()})'))

print("== 1. transferencia hand_l -> r3 ==")
hx = field(ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="hand_l"))'), "x")
hy = field(ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="hand_l"))'), "y")
tx = field(ev('JSON.stringify(window.__NS.project(-0.4,2.38,-0.18))'), "x")
ty = field(ev('JSON.stringify(window.__NS.project(-0.4,2.38,-0.18))'), "y")
print(f"hand_l=({hx},{hy}) -> r3=({tx},{ty})")
ab("mouse", "move", str(hx), str(hy))
ab("mouse", "down", "left")
time.sleep(0.3)
# Salir del radio de la presa de origen y entrar al de r3.
steps = 10
for i in range(1, steps + 1):
    mx = hx + (tx - hx) * i / steps
    my = hy + (ty - hy) * i / steps
    ab("mouse", "move", str(int(mx)), str(int(my)))
    time.sleep(0.1)
print("preview:", ev('JSON.stringify((function(){var p=null;return "ver-consola";})())'))
ab("screenshot", "download/e2e-9-preview.png")
ab("mouse", "up", "left")
time.sleep(3.0)
print("anclajes:", anchors())
print("estado:", ev('JSON.stringify(window.__NS.state())'))

print("== 2. reset con R ==")
ab("press", "r")
time.sleep(2.0)
print("anclajes tras reset:", anchors())
print("estado:", ev('JSON.stringify(window.__NS.state())'))

print("== 3. cambiar a RECUPERAR (autoStart) ==")
ab("find", "text", "RECUPERAR", "click")
time.sleep(3.5)
print("estado:", ev('JSON.stringify(window.__NS.state())'))
print("anclajes:", anchors())
ab("screenshot", "download/e2e-10-recuperar.png")

print("== 4. cambiar a ESTABILIZAR ==")
ab("find", "text", "ESTABILIZAR", "click")
time.sleep(3.5)
print("estado:", ev('JSON.stringify(window.__NS.state())'))
print("anclajes:", anchors())
ab("screenshot", "download/e2e-11-estabilizar.png")
print("== fin ==")
