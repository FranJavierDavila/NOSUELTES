#!/usr/bin/env python3
"""Diagnostico de la regresion en circuit_stage_3 (mov 19: foot_l->frest2, why vacio
= "assist no llega": validador OK pero cadena fisica insuficiente, leccion Task 19).

Fases:
  A) escalar 0..17, capturar telemetria COMPLETA antes del mov 18 (particulas,
     cadenas, autocolision, bisagras, preview hacia frest2, reject).
  B) intentar mov 18 y capturar por que no llega.
  C) aislar la causa: repetir con setTune (stretchTolerance 1.1 / preset viejo /
     jointLimitStiffness bajo) para ver que cambio la desbloquea.
"""
import subprocess, json, time, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))
URL = "http://localhost:3000/"

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
  window.__climb = {done: false, idx: 0, log: [], state: NS.state()};
  let lastWasFootOrRelease = false;
  (async () => {
    const log = window.__climb.log;
    for (let m = 0; m < UNTIL; m++) {
      const mv = RUTA[m];
      window.__climb.idx = m;
      let got = false, why = '', tele = [];
      for (let intento = 0; intento < 4 && !got; intento++) {
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
        const pvInfo = pvFin ? {snap: pvFin.snap, valid: pvFin.validity, err: Math.round(Math.hypot(mv.x - pvFin.target.x, mv.y - pvFin.target.y, mv.z - pvFin.target.z)*1000)/1000} : null;
        await sleep(240);
        NS.grab(mv.limb);
        const t0 = performance.now();
        while (performance.now() - t0 < 10000) {
          const anch = NS.anchors();
          if (anch && anch.some(a => a.limb === mv.limb && a.hold === mv.hold)) { got = true; break; }
          const st = NS.state();
          if (st === 'FALLEN' || st === 'TIMEOUT') { why = 'estado:' + st; break; }
          await sleep(250);
        }
        tele.push({i: intento, pv: pvInfo, anclado: got, drag: NS.dragging()});
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

TELEMETRY_JS = """
(() => {
  const NS = window.__NS;
  const mv = %MV%;
  return JSON.stringify({
    state: NS.state(),
    anchors: NS.anchors(),
    particles: NS.particles ? NS.particles() : null,
    chains: NS.chains ? NS.chains() : null,
    selfs: NS.selfs ? NS.selfs() : null,
    hinges: NS.hinges ? NS.hinges() : null,
    twist: NS.twists ? NS.twists() : null,
    reject: NS.reject ? NS.reject(mv.limb, mv.hold) : null,
    tone: NS.tone ? NS.tone() : null,
    tune: NS.tune ? NS.tune() : null
  });
})();
"""

def climb_until(sid, until, tune_patch=None):
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    arr = []
    for l, h in ruta:
        arr.append({"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]})
    if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
        return {"fatal": "no-cargo"}
    if not wait_state("READY", 25):
        return {"fatal": f"no-READY ({game_state()})"}
    time.sleep(0.8)
    if tune_patch:
        ev(f'JSON.stringify(window.__NS.setTune({json.dumps(tune_patch)}))')
    js = CLIMB_JS.replace("%RUTA%", json.dumps(arr)).replace("%UNTIL%", str(until))
    ev(js)
    t0 = time.time()
    while time.time() - t0 < 120:
        d = ev('JSON.stringify({done: window.__climb.done, idx: window.__climb.idx, state: window.__climb.state, log: window.__climb.log})')
        if d and d.get("done"):
            return d
        time.sleep(1.5)
    return {"fatal": "timeout-climb"}

def telemetry(mv):
    ev_js = TELEMETRY_JS.replace("%MV%", json.dumps(mv))
    return ev(ev_js)

def main():
    sid = "circuit_stage_3"
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    mv = {"limb": "foot_l", "hold": "frest2", "x": hw["frest2"][0], "y": hw["frest2"][1], "z": hw["frest2"][2]}

    # Fase A+B: tune NUEVO (por defecto)
    print("== FASE A+B: tune nuevo (por defecto) ==")
    r = climb_until(sid, 18)
    log = r.get("log", [])
    ok = sum(1 for e in log if e.get("got"))
    print(f"   movimientos OK: {ok}/18; estado={r.get('state')} fatal={r.get('fatal')}")
    for e in log:
        if not e.get("got"):
            print(f"   FALLO en {e['m']}: {e['limb']}->{e['hold']} why={e.get('why')} tele={e.get('tele')}")
    time.sleep(1)
    tel = telemetry(mv)
    if tel:
        print("   --- telemetria pre-mov19 ---")
        print("   estado:", tel.get("state"), "anchors:", tel.get("anchors"))
        print("   chains:", tel.get("chains"))
        print("   selfs:", tel.get("selfs"))
        print("   hinges:", tel.get("hinges"))
        print("   twist:", tel.get("twist"))
        print("   reject foot_l->frest2:", tel.get("reject"))
        if tel.get("particles"):
            keys = ("hip_l", "hip_r", "knee_l", "foot_l", "pelvis", "chest", "sh_l")
            print("   particles:", [p for p in tel["particles"] if p["id"] in keys])

    # Fase C1: repetir con stretchTolerance 1.1 (valor viejo)
    print("== FASE C1: setTune stretchTolerance=1.1 ==")
    r1 = climb_until(sid, 19, {"stretchTolerance": 1.1})
    log1 = r1.get("log", [])
    ok1 = sum(1 for e in log1 if e.get("got"))
    print(f"   movimientos OK: {ok1}/19; estado={r1.get('state')} fatal={r1.get('fatal')}")
    for e in log1:
        if not e.get("got"):
            print(f"   FALLO en {e['m']}: {e['limb']}->{e['hold']} why={e.get('why')} tele={e.get('tele')}")

    # Fase C2: preset viejo completo (tono 0.75, stretch 1.1, twist 0.45, kill 0.4)
    print("== FASE C2: preset viejo completo ==")
    r2 = climb_until(sid, 19, {"stretchTolerance": 1.1, "postureTone": 0.75, "twistLimitRad": 0.45, "pinVelKill": 0.4})
    log2 = r2.get("log", [])
    ok2 = sum(1 for e in log2 if e.get("got"))
    print(f"   movimientos OK: {ok2}/19; estado={r2.get('state')} fatal={r2.get('fatal')}")
    for e in log2:
        if not e.get("got"):
            print(f"   FALLO en {e['m']}: {e['limb']}->{e['hold']} why={e.get('why')} tele={e.get('tele')}")

    # Fase C3: tune nuevo pero autocolision+hinges flojos (jointLimitStiffness 0.15)
    print("== FASE C3: jointLimitStiffness=0.15 (autocolision casi off) ==")
    r3 = climb_until(sid, 19, {"jointLimitStiffness": 0.15})
    log3 = r3.get("log", [])
    ok3 = sum(1 for e in log3 if e.get("got"))
    print(f"   movimientos OK: {ok3}/19; estado={r3.get('state')} fatal={r3.get('fatal')}")
    for e in log3:
        if not e.get("got"):
            print(f"   FALLO en {e['m']}: {e['limb']}->{e['hold']} why={e.get('why')} tele={e.get('tele')}")

if __name__ == "__main__":
    main()
