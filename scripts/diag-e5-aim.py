#!/usr/bin/env python3
"""Mide la condicion del mapeo cursor->plano bajo el techo (circuit_stage_5):
estabilidad con cursor quieto y amplificacion por pixel en h4 vs h2."""
import subprocess, json, time, os, sys, re
BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
os.chdir(BASE)

_src = open(os.path.join(BASE, "e2e-circuito-full.py"), encoding="utf-8").read()
CLIMB_JS = re.search(r'CLIMB_JS = """(.*?)"""', _src, re.S).group(1)
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))

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

def game_state():
    d = ev('JSON.stringify({s: window.__NS.state()})')
    return d.get("s") if d else None

def wait_state(want, timeout=25):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if game_state() == want:
            return True
        time.sleep(0.5)
    return False

FIRE_JS = """
((x, y) => {
  const canvas = document.querySelector('canvas');
  canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
})(%X%, %Y%)
"""

ab("open", "http://localhost:3000/")
time.sleep(2.5)
import e2e_lib as lib
lib.enter(ab)
time.sleep(1.2)
sid = "circuit_stage_5"
ruta = RUTAS[sid]["moves"]
hw = RUTAS[sid]["holds_world"]
parcial = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta[:7]]
ev(f'JSON.stringify(window.__NS.load("{sid}"))')
wait_state("READY", 25)
time.sleep(0.8)
ok7 = False
for intento in range(4):
    ab("eval", "window.__climb=null;")
    ab("eval", CLIMB_JS.replace("%RUTA%", json.dumps(parcial)))
    t0 = time.time()
    c = None
    while time.time() - t0 < 90:
        c = ev('JSON.stringify(window.__climb || null)')
        if c and c.get("done"):
            break
        time.sleep(2)
    if c and all(r["got"] for r in c["log"]) and game_state() in ("PLAYING",):
        ok7 = True
        break
    print(f"   parcial intento {intento+1} fallo: {[ (r['m'], r['why']) for r in (c or {}).get('log',[]) if not r['got'] ]} estado={game_state()}")
    ev(f'JSON.stringify(window.__NS.load("{sid}"))')
    wait_state("READY", 25)
    time.sleep(0.8)
print("parcial 1-7 OK:", ok7)
if not ok7:
    sys.exit(1)

# Presionar grab de hand_l y medir estabilidad con cursor quieto
ls = ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="hand_l"))')
ab("eval", FIRE_JS.replace("%X%", str(ls["x"])).replace("%Y%", str(ls["y"])))
time.sleep(0.3)
ev('JSON.stringify(window.__NS.grab("hand_l"))')
time.sleep(0.4)
print("\n-- estabilidad con cursor QUIETO (2,5 s, cada 350 ms):")
samples = []
for i in range(8):
    p = ev('JSON.stringify(window.__NS.preview())')
    if isinstance(p, dict) and p.get("target"):
        samples.append((p["target"]["x"], p["target"]["y"], p["target"]["z"], p["snap"]))
        print(f"   t{i}: target=({p['target']['x']:.3f},{p['target']['y']:.3f},{p['target']['z']:.3f}) snap={p['snap']}")
    else:
        print(f"   t{i}: preview={p!r}")
    time.sleep(0.35)

# Amplificacion: mover el cursor +-6 px y medir el delta del target (sin snap: usar el target crudo)
print("\n-- amplificacion por pixel (delta target / delta cursor):")
for dx in (-6, 6):
    ab("eval", FIRE_JS.replace("%X%", str(ls["x"] + dx)).replace("%Y%", str(ls["y"])))
    time.sleep(0.45)
    p = ev('JSON.stringify(window.__NS.preview())')
    if isinstance(p, dict) and p.get("target"):
        print(f"   dx={dx:+d}px -> target=({p['target']['x']:.3f},{p['target']['y']:.3f},{p['target']['z']:.3f}) snap={p['snap']}")
    else:
        print(f"   dx={dx:+d}px -> preview={p!r}")

# Soltar y dejar el cuerpo como estaba (re-anclar hand_l a h2 no es trivial; recargamos)
ev('JSON.stringify(window.__NS.grab("hand_l"))')
time.sleep(0.3)
cam = ev('JSON.stringify(window.__NS.camera())')
print("\ncamara:", cam)
