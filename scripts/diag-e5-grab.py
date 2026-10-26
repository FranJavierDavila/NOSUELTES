#!/usr/bin/env python3
"""Diagnostico del fallo 'grab' en circuit_stage_5 (EL TECHO) a partir del mov 8."""
import subprocess, json, time, os, sys, re
BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
os.chdir(BASE)

_src = open(os.path.join(BASE, "e2e-circuito-full.py"), encoding="utf-8").read()
_m = re.search(r'CLIMB_JS = """(.*?)"""', _src, re.S)
CLIMB_JS = _m.group(1)

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

RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))

def main():
    ab("open", "http://localhost:3000/")
    time.sleep(2.5)
    ab("console", "--clear")
    import e2e_lib as lib
    lib.enter(ab)
    time.sleep(1.2)
    sid = "circuit_stage_5"
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    parcial = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta[:9]]
    print("cargando", sid)
    ev(f'JSON.stringify(window.__NS.load("{sid}"))')
    wait_state("READY", 25)
    time.sleep(0.8)
    js = CLIMB_JS.replace("%RUTA%", json.dumps(parcial))
    ab("eval", js)
    t0 = time.time()
    while time.time() - t0 < 90:
        c = ev('JSON.stringify(window.__climb || null)')
        if c and c.get("done"):
            break
        time.sleep(2)
    print("parcial:", json.dumps(c.get("log") if c else None))
    time.sleep(1.0)

    probe = ev("""
JSON.stringify((() => {
  const NS = window.__NS;
  const out = {};
  out.state = NS.state();
  out.anchors = NS.anchors();
  out.dragging = NS.dragging();
  out.selected = NS.selected();
  const ls = NS.limbScreen().find(l => l.limb === 'hand_l');
  out.limbScreen_hand_l = ls;
  out.pick_hand_l = ls ? NS.pickAt(ls.x, ls.y) : null;
  out.pickNearest = ls ? NS.pickNearest(ls.x, ls.y) : null;
  out.grab_hand_l = NS.grab('hand_l');
  out.dragging_despues = NS.dragging();
  out.preview = NS.preview();
  out.reject_h4 = NS.reject('hand_l', 'h4');
  out.camera = NS.camera();
  return out;
})())
""")
    print("probe:", json.dumps(probe, indent=1, ensure_ascii=False))

if __name__ == "__main__":
    main()
