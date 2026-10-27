#!/usr/bin/env python3
"""Diagnostico del movimiento fallido en E2 (foot_r->fb1) con la fisica nueva:
sirve el movimiento con el servo y registra cada 300 ms el error del pie,
las bisagras, la rodilla y el estado. Objetivo: ver QUE frena el pie."""
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

SERVO_JS = """
(() => {
  const NS = window.__NS;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
  window.__servoDone = null;
  (async () => {
    try {
      const ls = NS.limbScreen().find(l => l.limb === "%LIMB%");
      if (ls) { fire(ls.x, ls.y); await sleep(150); }
      if (!NS.grab("%LIMB%")) { window.__servoDone = {ok: false, why: 'grab'}; return; }
      await sleep(200);
      let err = 1e9;
      for (let i = 0; i < 12; i++) {
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
      NS.grab("%LIMB%");
      window.__servoDone = {ok: true, err: Math.round(err * 1000) / 1000};
    } catch (e) {
      window.__servoDone = {ok: false, why: String(e)};
    }
  })();
})();
"""

def servo_move(limb, hx, hy, hz):
    js = (SERVO_JS.replace("%LIMB%", limb).replace("%HX%", repr(hx)).replace("%HY%", repr(hy)).replace("%HZ%", repr(hz)))
    ab("eval", js)
    t0 = time.time()
    while time.time() - t0 < 10:
        d = ev('JSON.stringify(window.__servoDone || null)')
        if d:
            return d
        time.sleep(0.2)
    return None

def main():
    import e2e_lib as lib
    ruta = RUTAS["circuit_stage_2"]["moves"]
    holds = {h["id"]: h["position"] for h in json.loads(ab("eval", "undefined") or "null") or []} if False else None
    ab("open", "http://localhost:3000/")
    time.sleep(4)
    lib.enter(ab)
    time.sleep(2)
    ab("eval", "document.getElementById('tut-skip')?.click()")
    time.sleep(1)
    ab("eval", "window.__NS.load('circuit_stage_2')")
    time.sleep(5)
    # Move 1: foot_l -> fa1
    fa1 = RUTAS and None
    # presas desde el manifest del wall cargado: usar __NS.reject + preview? Mas facil:
    # el propio lote del circuito-full lee las posiciones de las presas via project... aqui
    # las leemos del JSON de rutas no estan; usamos el manifest de la pared via fetch.
    walljson = json.load(open(os.path.join(os.path.dirname(BASE), "public", "content", "walls", "wall_circuit_02.json"), encoding="utf-8"))
    manifest = {h["id"]: h["position"] for h in walljson["holds"]}
    m1 = ruta[0]  # foot_l -> fa1
    m2 = ruta[1]  # foot_r -> fb1
    print("move1:", m1, "move2:", m2)
    p1 = manifest[m1[1]]
    d = servo_move(m1[0], *p1)
    print("servo move1:", d)
    time.sleep(2.5)
    print("anclajes:", ev("JSON.stringify(window.__NS.anchors())"))
    # Move 2 con telemetria
    p2 = manifest[m2[1]]
    js = (SERVO_JS.replace("%LIMB%", m2[0]).replace("%HX%", repr(p2[0])).replace("%HY%", repr(p2[1])).replace("%HZ%", repr(p2[2])))
    ab("eval", js)
    for i in range(16):
        tel = ev('JSON.stringify((function(){var N=window.__NS; var fr=N.positionOfLimb ? null : null; return null;})())')
        # telemetria pie + bisagras + preview
        foot = ev('JSON.stringify((function(){var N=window.__NS; var s=N.limbScreen().find(l=>l.limb==="foot_r"); return s;})())')
        hg = ev('JSON.stringify(window.__NS.hinges())')
        pv = ev('JSON.stringify(window.__NS.preview())')
        st = ev("window.__NS.state()")
        done = ev('JSON.stringify(window.__servoDone || null)')
        print(f"t={i*0.3:.1f} estado={st} pv={pv} hinges={hg} done={done}")
        time.sleep(0.3)
        if done:
            break
    time.sleep(3)
    print("anclajes finales:", ev("JSON.stringify(window.__NS.anchors())"))
    print("estado final:", ev("window.__NS.state()"))

if __name__ == "__main__":
    main()
