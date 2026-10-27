#!/usr/bin/env python3
"""Medicion del margen de alcance en el mov 19 de E3 (foot_l->frest2).
Escala 0..17, luego muestrea NS.reach('foot_l','frest2') durante 20 s (settle) y
mientras la extremidad agarra y el servo la acerca al target: cuanta dist/limit.
"""
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
    sid = "circuit_stage_3"
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    arr = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta]
    mv = arr[18]
    if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
        print("no cargo"); sys.exit(1)
    if not wait_state("READY", 25):
        print(f"no READY ({game_state()})"); sys.exit(1)
    time.sleep(0.8)
    ev(CLIMB_JS.replace("%RUTA%", json.dumps(arr)).replace("%UNTIL%", "18"))
    t0 = time.time()
    while time.time() - t0 < 200:
        d = ev('JSON.stringify({done: window.__climb.done})')
        if d and d.get("done"): break
        time.sleep(1.5)
    ok = ev('JSON.stringify(window.__climb.log.map(e => e.got))')
    print("0..17:", "OK" if ok and all(ok) else f"incompleto {ok}")

    # Muestreo del reach durante el settle
    print("--- reach foot_l->frest2 durante settle (sin agarrar) ---")
    for i in range(12):
        r = ev('JSON.stringify(window.__NS.reach("foot_l","frest2"))')
        print(f"   t={i*0.5:.1f}s dist={r['dist']} limit={r['limit']} verdict={r['verdict']} root={r['root']}")
        time.sleep(0.5)

    # Ahora agarrar foot_l y llevar el cursor al target: como evoluciona el reach
    # con la asistencia activa
    print("--- agarrando foot_l y apuntando a frest2 ---")
    ls = ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="foot_l"))')
    canvas_fire = ev('JSON.stringify(window.__NS.limbScreen().find(l=>l.limb==="foot_l"))')
    ab("eval", f"""
(() => {{
  const NS = window.__NS;
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {{clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}}));
  const ls = NS.limbScreen().find(l => l.limb === 'foot_l');
  fire(ls.x, ls.y);
  window.__grabT0 = performance.now();
}})()
""")
    time.sleep(0.4)
    ev('JSON.stringify(window.__NS.grab("foot_l"))')
    time.sleep(0.4)
    target = {"x": mv["x"], "y": mv["y"], "z": mv["z"]}
    for i in range(16):
        # seguir el preview hacia el target
        ev(f"""
(() => {{
  const NS = window.__NS;
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {{clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}}));
  const pv = NS.preview();
  const tgt = {json.dumps(target)};
  if (pv) {{
    const cur = NS.project(pv.target.x, pv.target.y, pv.target.z);
    const des = NS.project(tgt.x, tgt.y, tgt.z);
    fire(cur.x + (des.x - cur.x), cur.y + (des.y - cur.y));
  }}
}})()
""")
        time.sleep(0.35)
        r = ev('JSON.stringify(window.__NS.reach("foot_l","frest2"))')
        pv = ev('JSON.stringify(window.__NS.preview())')
        pvs = f"snap={pv['snap']} valid={pv['validity']}" if pv else "pv=null"
        print(f"   t={i*0.35:.2f}s dist={r['dist']} limit={r['limit']} verdict={r['verdict']} {pvs}")
    # cerrar drag si quedo abierto
    ev('if (window.__NS.dragging()) window.__NS.grab("foot_l"); JSON.stringify("cerrado")')

def main_wrap():
    main()

if __name__ == "__main__":
    main_wrap()
