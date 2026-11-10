#!/usr/bin/env python3
"""Diagnostico del gancho de pie en el techo (mov 13: foot_r->fgancho1)."""
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

ab("open", "http://localhost:3000/")
time.sleep(2.5)
import e2e_lib as lib
lib.enter(ab)
time.sleep(1.2)
sid = "circuit_stage_5"
ruta = RUTAS[sid]["moves"]
hw = RUTAS[sid]["holds_world"]
parcial = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta[:12]]
print("movimientos 1-12:", " ".join(f"{l}:{h}" for l, h in ruta[:12]))
ev(f'JSON.stringify(window.__NS.load("{sid}"))')
wait_state("READY", 25)
time.sleep(0.8)
for intento in range(4):
    ab("eval", "window.__climb=null;")
    ab("eval", CLIMB_JS.replace("%RUTA%", json.dumps(parcial)))
    t0 = time.time()
    c = None
    while time.time() - t0 < 120:
        c = ev('JSON.stringify(window.__climb || null)')
        if c and c.get("done"):
            break
        time.sleep(2)
    if c and all(r["got"] for r in c["log"]) and game_state() in ("PLAYING", "READY"):
        break
    print(f"   parcial intento {intento+1}: {[ (r['m']+1, r['why']) for r in (c or {}).get('log',[]) if not r['got'] ]} estado={game_state()}")
    ev(f'JSON.stringify(window.__NS.load("{sid}"))')
    wait_state("READY", 25)
    time.sleep(0.8)
print("parcial 1-12 OK:", bool(c and all(r["got"] for r in c["log"])))
time.sleep(1.0)

probe = ev("""
JSON.stringify((() => {
  const NS = window.__NS;
  const out = {};
  out.state = NS.state();
  out.anchors = NS.anchors();
  out.pelvisY = Math.round(NS.pelvisY() * 100) / 100;
  out.hip_r = NS.chainInfo('foot_r');
  out.hip_l = NS.chainInfo('foot_l');
  out.reject_fgancho1 = NS.reject('foot_r', 'fgancho1');
  out.reject_h7 = NS.reject('hand_r', 'h7');
  out.reject_h8 = NS.reject('hand_l', 'h8');
  out.limbs = {};
  for (const l of NS.limbScreen()) out.limbs[l.limb] = {x: l.x, y: l.y};
  out.camera = NS.camera();
  const w = %HW%;
  out.fgancho1 = w['fgancho1'];
  out.h7 = w['h7'];
  return out;
})())
""".replace("%HW%", json.dumps(hw)))
print("probe:", json.dumps(probe, indent=1, ensure_ascii=False))
