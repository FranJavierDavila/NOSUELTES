#!/usr/bin/env python3
"""Telemetria del drag de foot_l hacia frest2 en E3 (mov 19): que constraint se
activa y bloquea. Escala 0..17 con el servo probado, luego agarra foot_l, apunta
a frest2 como el servo real y muestrea: reach (dist/limit), cadenas (ratio), selfs
(distancia vs minimo), bisagras (dev, y la de rodilla comprimida), preview.
"""
import subprocess, json, time, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))

def ab(*a):
    return subprocess.run(["agent-browser", *a], capture_output=True, text=True).stdout.strip()

def ev(js):
    raw = ab("eval", js)
    for _ in range(4):
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

CLIMB_JS = """
(() => {
  const NS = window.__NS;
  const RUTA = %RUTA%;
  const UNTIL = %UNTIL%;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
  window.__climb = {done: false, idx: 0, log: []};
  let lastWasFootOrRelease = false;
  (async () => {
    const log = window.__climb.log;
    for (let m = 0; m < UNTIL; m++) {
      const mv = RUTA[m];
      window.__climb.idx = m;
      let got = false, why = '';
      for (let intento = 0; intento < 3 && !got; intento++) {
        if (intento > 0) await sleep(2000);
        else if (lastWasFootOrRelease) await sleep(1500);
        const st0 = NS.state();
        if (st0 !== 'PLAYING' && st0 !== 'READY') { why = 'estado:' + st0; break; }
        if (NS.dragging()) { NS.grab(mv.limb); await sleep(300); }
        if (NS.dragging()) { why = 'drag-residual'; break; }
        try { NS.relieve(); } catch (e) {}
        const ls = NS.limbScreen().find(l => l.limb === mv.limb);
        if (ls) { fire(ls.x, ls.y); await sleep(150); }
        if (!NS.grab(mv.limb)) { why = 'grab'; continue; }
        await sleep(200);
        let err = 1e9;
        for (let i = 0; i < 14; i++) {
          const pv = NS.preview();
          if (!pv) break;
          err = Math.hypot(mv.x - pv.target.x, mv.y - pv.target.y, mv.z - pv.target.z);
          if (err < 0.04) break;
          const cur = NS.project(pv.target.x, pv.target.y, pv.target.z);
          const des = NS.project(mv.x, mv.y, mv.z);
          fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
          await sleep(120);
        }
        await sleep(240);
        NS.grab(mv.limb);
        const t0 = performance.now();
        while (performance.now() - t0 < 8000) {
          const anch = NS.anchors();
          if (anch && anch.some(a => a.limb === mv.limb && a.hold === mv.hold)) { got = true; break; }
          const st = NS.state();
          if (st === 'FALLEN' || st === 'TIMEOUT') { why = 'estado:' + st; break; }
          await sleep(250);
        }
        if (!got) { if (NS.dragging()) NS.grab(mv.limb); await sleep(300); }
      }
      log.push({m, got, why});
      if (!got) break;
      lastWasFootOrRelease = mv.limb.startsWith('foot');
      await sleep(600);
    }
    window.__climb.done = true;
  })();
})();
"""

def main():
    sid = "circuit_stage_2"
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    arr = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta]
    mv = arr[22]
    if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
        print("no cargo"); sys.exit(1)
    if not wait_state("READY", 25):
        print(f"no READY ({game_state()})"); sys.exit(1)
    time.sleep(0.8)
    ev(CLIMB_JS.replace("%RUTA%", json.dumps(arr)).replace("%UNTIL%", "18"))
    t0 = time.time()
    while time.time() - t0 < 220:
        d = ev('JSON.stringify({done: window.__climb.done})')
        if d and d.get("done"): break
        time.sleep(1.5)
    ok = ev('JSON.stringify(window.__climb.log.map(e => e.got))')
    print("0..17:", "OK" if ok and all(ok) else f"incompleto {ok}")
    if not (ok and all(ok)):
        sys.exit(2)

    # Servo del drag con telemetria: grabar foot_l y apuntar a frest2 durante 12 s
    ev(f"""
(() => {{
  const NS = window.__NS;
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {{clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}}));
  const ls = NS.limbScreen().find(l => l.limb === 'foot_l');
  fire(ls.x, ls.y);
  window.__dragOn = true;
}})()
""")
    time.sleep(0.5)
    ev('JSON.stringify(window.__NS.grab("foot_l"))')
    time.sleep(0.5)
    for i in range(30):
        ev(f"""
(() => {{
  const NS = window.__NS;
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {{clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}}));
  const pv = NS.preview();
  const tgt = {json.dumps(mv)};
  if (pv) {{
    const cur = NS.project(pv.target.x, pv.target.y, pv.target.z);
    const des = NS.project(tgt.x, tgt.y, tgt.z);
    fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
  }}
}})()
""")
        time.sleep(0.4)
        r = ev('JSON.stringify(window.__NS.reach("foot_l","frest2"))')
        pv = ev('JSON.stringify(window.__NS.preview())')
        chains = ev('JSON.stringify(window.__NS.chains().filter(c=>c.limb==="foot_l"||c.limb==="foot_r"))')
        selfs = ev('JSON.stringify(window.__NS.selfs().filter(s=>s.dist < s.minDist*2.2))')
        hinges = ev('JSON.stringify(window.__NS.hinges().filter(h=>h.id.indexOf("knee")>=0))')
        pvs = f"snap={pv['snap']},valid={pv['validity']}" if pv else "pv=null"
        cs = ",".join(f"{c['limb']}:{c['ratio']:.2f}" for c in (chains or []))
        ss = ",".join(f"{s['id']}:{s['dist']:.3f}/{s['minDist']}" for s in (selfs or [])) or "ninguna-cerca"
        hs = ",".join(f"{h['id']}:{h['dev']:.3f}/{h['tol']}" for h in (hinges or []))
        print(f"   t={i*0.4:.1f}s reach={r['dist']:.3f}/{r['limit']} {r['verdict']} pv={pvs} chains[{cs}] selfs[{ss}] hinges[{hs}]")
    ev('if (window.__NS.dragging()) window.__NS.grab("foot_l"); JSON.stringify("ok")')

if __name__ == "__main__":
    main()
