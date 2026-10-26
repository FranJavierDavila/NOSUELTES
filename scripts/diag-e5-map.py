#!/usr/bin/env python3
"""Sondeo fino del mapeo de apuntado en el techo: proyeccion de presas al cursor
y comportamiento del target de arrastre con el fix de rasante."""
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
    if c and all(r["got"] for r in c["log"]) and game_state() == "PLAYING":
        break
    ev(f'JSON.stringify(window.__NS.load("{sid}"))')
    wait_state("READY", 25)
    time.sleep(0.8)
print("parcial 1-7:", all(r["got"] for r in (c or {}).get("log", [])))

# Proyeccion de todas las presas y distancias al punto del cursor de hand_l
ls = ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="hand_l"))')
cx, cy = ls["x"], ls["y"]
print(f"cursor hand_l en ({cx},{cy})")
projs = ev("""
JSON.stringify((() => {
  const NS = window.__NS;
  const anch = {};
  for (const a of NS.anchors()) anch[a.limb] = a.hold;
  const out = [];
  for (const id of ['start_l','start_r','h1','h2','h3','h4','h5','fb1','fa1','fb2','fa2','top']) {
    const w = %HW%;
    if (!w[id]) continue;
    const s = NS.project(w[id][0], w[id][1], w[id][2]);
    out.push({id, d: Math.round(Math.hypot(s.x-%CX%, s.y-%CY%)), s: {x: Math.round(s.x), y: Math.round(s.y)}, w: w[id].map(v=>Math.round(v*100)/100)});
  }
  out.sort((a,b)=>a.d-b.d);
  return out;
})())
""".replace("%HW%", json.dumps(hw)).replace("%CX%", str(cx)).replace("%CY%", str(cy)))
print("presas por distancia en pantalla al cursor:")
for p in (projs or [])[:6]:
    print(f"   {p['id']:8s} d={p['d']:4d}px  screen=({p['s']['x']},{p['s']['y']})  mundo={p['w']}")

# Fire en el cursor y comprobar el preview SIN grab (el preview requiere drag? miramos selected)
ab("eval", FIRE_JS.replace("%X%", str(cx)).replace("%Y%", str(cy)))
time.sleep(0.4)
ev('JSON.stringify(window.__NS.grab("hand_l"))')
time.sleep(0.5)
p = ev('JSON.stringify(window.__NS.preview())')
print("preview tras grab en el cursor:", json.dumps(p))
# mover +-6px y ver el target
for dx in (-6, 0, 6):
    ab("eval", FIRE_JS.replace("%X%", str(cx + dx)).replace("%Y%", str(cy)))
    time.sleep(0.4)
    p = ev('JSON.stringify(window.__NS.preview())')
    print(f"   dx={dx:+d}: target={json.dumps(p.get('target') if isinstance(p, dict) else p)} snap={p.get('snap') if isinstance(p, dict) else '?'}")
ev('JSON.stringify(window.__NS.grab("hand_l"))')
