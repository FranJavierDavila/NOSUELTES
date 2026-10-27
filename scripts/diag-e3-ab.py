#!/usr/bin/env python3
"""A/B quirurgico del mov 19 de E3 (foot_l->frest2) con tune NUEVO:
escalar 0..17, luego intentar el mov 19 bajo 4 condiciones de tune:
  1. tune nuevo intacto (reproducir el fallo)
  2. + setTune({stretchTolerance: 1.1})   -> sospechoso: tope de cadena
  3. + setTune({jointLimitStiffness: 0.2}) -> sospechoso: autocolision/bisagras
  4. + setTune({pinVelKill: 0.4, twistLimitRad: 0.45, postureTone: 0.75}) -> resto
Cada intento recarga el escenario y re-escala 0..17 (mismo estado inicial).
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
  window.__climb = {done: false, idx: 0, log: [], state: NS.state(), pvLog: []};
  let lastWasFootOrRelease = false;
  (async () => {
    const log = window.__climb.log;
    for (let m = 0; m < UNTIL; m++) {
      const mv = RUTA[m];
      window.__climb.idx = m;
      let got = false, why = '', tele = [];
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
        const pvFin = NS.preview();
        const pvInfo = pvFin ? {snap: pvFin.snap, valid: pvFin.validity} : null;
        if (m === UNTIL - 1) {
          // Registrar la evolucion del preview del ULTIMO movimiento
          window.__climb.pvLog.push({t: performance.now(), pv: pvInfo});
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
        tele.push({i: intento, pv: pvInfo, anclado: got});
        if (!got && !why) {
          if (NS.dragging()) NS.grab(mv.limb);
          await sleep(300);
        }
      }
      log.push({m: m, limb: mv.limb, hold: mv.hold, got: got, why: why, tele: tele});
      if (!got) break;
      lastWasFootOrRelease = mv.limb.startsWith('foot');
      await sleep(600);
    }
    window.__climb.done = true;
    window.__climb.state = NS.state();
  })();
})();
"""

def attempt(sid, until, patch_after=None, label=""):
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    arr = [{"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]} for l, h in ruta]
    if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
        return {"fatal": "no-cargo"}
    if not wait_state("READY", 25):
        return {"fatal": f"no-READY ({game_state()})"}
    time.sleep(0.8)
    js = CLIMB_JS.replace("%RUTA%", json.dumps(arr)).replace("%UNTIL%", str(until))
    ev(js)
    t0 = time.time()
    applied = False
    while time.time() - t0 < 240:
        d = ev('JSON.stringify({done: window.__climb.done, idx: window.__climb.idx, state: window.__climb.state, log: window.__climb.log})')
        if d and not applied and patch_after is not None and d.get("idx", 0) >= until - 1:
            # Aplicar el parche justo antes del ultimo movimiento (pose ya montada)
            ev(f'JSON.stringify(window.__NS.setTune({json.dumps(patch_after)}))')
            applied = True
        if d and d.get("done"):
            return d
        time.sleep(1.2)
    return {"fatal": "timeout-climb"}

def report(label, r):
    log = r.get("log", [])
    ok = sum(1 for e in log if e.get("got"))
    last = log[-1] if log else None
    print(f"   [{label}] OK {ok}/{len(log)} estado={r.get('state')} fatal={r.get('fatal')}")
    if last and not last.get("got"):
        print(f"      fallo en idx {last['m']} {last['limb']}->{last['hold']} why={last.get('why')} tele={last.get('tele')}")

def main():
    sid = "circuit_stage_3"
    print("== 1. tune nuevo intacto (reproducir) ==")
    report("nuevo", attempt(sid, 19))
    print("== 2. +stretchTolerance 1.1 ==")
    report("stretch1.1", attempt(sid, 19, {"stretchTolerance": 1.1}))
    print("== 3. +jointLimitStiffness 0.2 ==")
    report("jl0.2", attempt(sid, 19, {"jointLimitStiffness": 0.2}))
    print("== 4. resto del preset viejo ==")
    report("resto", attempt(sid, 19, {"pinVelKill": 0.4, "twistLimitRad": 0.45, "postureTone": 0.75}))

if __name__ == "__main__":
    main()
