#!/usr/bin/env python3
"""Diagnostico puntual: por que foot_l -> fa1 no ancla en circuit_stage_1."""
import subprocess, json, time, os, sys
BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    for _ in range(3):
        try:
            d = json.loads(raw)
            if isinstance(d, str):
                raw = d; continue
            return d
        except Exception:
            return None
    return None

ab("open", "http://localhost:3000/")
time.sleep(2.5)
ab("eval", "(() => { const b = document.querySelector('#hud-intro-dismiss'); if (b) b.click(); return 'ok'; })()")
time.sleep(1.0)
ev('JSON.stringify(window.__NS.load("circuit_stage_1"))')
t0 = time.time()
while time.time() - t0 < 16:
    d = ev('JSON.stringify({s: window.__NS.state()})')
    if d and d.get("s") == "READY":
        break
    time.sleep(0.4)
time.sleep(0.8)

hw = RUTAS["circuit_stage_1"]["holds_world"]
print("fa1 world:", hw["fa1"])
print("fb1 world:", hw["fb1"])

# Movimiento 1: foot_r -> fb1 con el mismo servo del E2E.
SERVO = """
(() => {
  const NS = window.__NS;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
  window.__servoDone = null;
  (async () => {
    const ls = NS.limbScreen().find(l => l.limb === "%LIMB%");
    if (ls) { fire(ls.x, ls.y); await sleep(150); }
    if (!NS.grab("%LIMB%")) { window.__servoDone = {ok: false, why: 'grab'}; return; }
    await sleep(200);
    let err = 1e9;
    for (let i = 0; i < 8; i++) {
      const pv = NS.preview();
      if (!pv) break;
      const dx = %HX% - pv.target.x, dy = %HY% - pv.target.y, dz = %HZ% - pv.target.z;
      err = Math.hypot(dx, dy, dz);
      if (err < 0.05) break;
      const cur = NS.project(pv.target.x, pv.target.y, pv.target.z);
      const des = NS.project(%HX%, %HY%, %HZ%);
      fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
      await sleep(120);
    }
    await sleep(240);
    const pv2 = NS.preview();
    NS.grab("%LIMB%");
    window.__servoDone = {ok: true, err: err, preview: pv2};
  })();
})();
"""
def servo(limb, hold):
    t = hw[hold]
    js = (SERVO.replace("%LIMB%", limb).replace("%HX%", repr(t[0])).replace("%HY%", repr(t[1])).replace("%HZ%", repr(t[2])))
    ab("eval", js)
    t0 = time.time()
    while time.time() - t0 < 8:
        d = ev('JSON.stringify(window.__servoDone || null)')
        if d:
            return d
        time.sleep(0.2)
    return None

d = servo("foot_r", "fb1")
print("servo foot_r:", d)
t0 = time.time()
while time.time() - t0 < 6:
    a = ev('JSON.stringify(window.__NS.anchors())')
    if a and any(x["limb"] == "foot_r" for x in a):
        break
    time.sleep(0.3)
print("anchors:", ev('JSON.stringify(window.__NS.anchors())'))
time.sleep(0.8)

print("reject foot_l->fa1 ANTES del arrastre:", ev('JSON.stringify({r: window.__NS.reject("foot_l", "fa1")})'))
chain = ev('JSON.stringify(window.__NS.chainInfo("foot_l"))')
print("chainRoot foot_l (hipL):", chain)
print("limbScreen:", ev('JSON.stringify(window.__NS.limbScreen())'))
d = servo("foot_l", "fa1")
print("servo foot_l:", d)
t0 = time.time()
while time.time() - t0 < 6:
    a = ev('JSON.stringify(window.__NS.anchors())')
    if a and any(x["limb"] == "foot_l" for x in a):
        break
    time.sleep(0.3)
print("anchors final:", ev('JSON.stringify(window.__NS.anchors())'))
print("eventos:", ev('JSON.stringify(window.__NS.events())'))
print("estado:", ev('JSON.stringify({s: window.__NS.state()})'))
print("reject foot_l->fa1 DESPUES:", ev('JSON.stringify({r: window.__NS.reject("foot_l", "fa1")})'))
