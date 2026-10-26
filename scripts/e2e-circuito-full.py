#!/usr/bin/env python3
"""E2E de RESOLUBILIDAD COMPLETA del circuito (peticion del jugador: "verifica que
los caminos no sean bloqueantes y si resolubles").

A diferencia de e2e-circuito.py (movimientos parciales: 4/3/2/2/3), este script
ESCALA CADA ESCENARIO DE PRINCIPIO A FIN con el servo (drag real sobre el canvas),
siguiendo la ruta auditada de circuito_rutas.json (ruta_of corregida: escalera de
manos completa + pies de seguimiento + descansos).

Por escenario:
  1. load -> READY
  2. lote EN PAGINA (async): por movimiento -> relieve de fatiga (ritmo rig, leccion
     Task 17), agarre, servo de cursor contra la presa (proyeccion viva), soltar,
     espera de anclaje con reintentos (3 por movimiento).
  3. si cae (FALLEN) o un movimiento no ancla -> recarga el escenario y reinicia la
     ruta desde el principio (max 5 intentos).
  4. exito = estado SUCCESS (ambas manos en la presa cima, 0,5 s estable).

Capturas de progreso y cima en download/circuito-full-e*.png.
"""
import subprocess, json, time, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
RUTAS = json.load(open(os.path.join(BASE, "circuito_rutas.json"), encoding="utf-8"))
URL = "http://localhost:3000/"
SHOTS = os.path.join(os.path.dirname(BASE), "download")
os.makedirs(SHOTS, exist_ok=True)

STAGES = ["circuit_stage_1", "circuit_stage_2", "circuit_stage_3", "circuit_stage_4", "circuit_stage_5"]

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

def console_errors():
    raw = ab("console")
    bad = []
    for line in (raw or "").splitlines():
        low = line.lower()
        if ("error" in low or "uncaught" in low) and "audiocontext" not in low and "favicon" not in low:
            bad.append(line.strip())
    return bad

def shot(name):
    ab("screenshot", os.path.join(SHOTS, name))

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
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const canvas = document.querySelector('canvas');
  const fire = (x, y) => canvas.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true}));
  window.__climb = {done: false, idx: 0, log: [], state: NS.state()};
  let lastWasFootOrRelease = false;
  (async () => {
    const log = window.__climb.log;
    for (let m = 0; m < RUTA.length; m++) {
      const mv = RUTA[m];
      window.__climb.idx = m;
      let got = false, why = '', tele = [];
      // RELEASE (hold ""): soltar la extremidad en el aire (colgar) sin re-anclar.
      // Cursor hacia aire libre (alejado de toda presa proyectada) para que el
      // mapa no capture ningun snap; el rechazo 'debe_terminar_en_presa' libera.
      if (mv.hold === '') {
        for (let intento = 0; intento < 4 && !got; intento++) {
          const st0 = NS.state();
          if (st0 !== 'PLAYING' && st0 !== 'READY') { why = 'estado:' + st0; break; }
          const ancl0 = (NS.anchors() || []).some(a => a.limb === mv.limb);
          // Primario determinista: hook E2E de suelta directa (equivale al cut
          // loose del jugador, que se verifica por separado con el cursor).
          if (ancl0 && NS.releaseLimb) {
            NS.releaseLimb(mv.limb);
            await sleep(600);
            const anclA = (NS.anchors() || []).some(a => a.limb === mv.limb);
            got = ancl0 && !anclA;
            tele.push({i: intento, release: 'releaseLimb', ok: got});
          }
          // Respaldo: suelta por cursor al aire (el camino del jugador).
          if (!got) {
            const ls = NS.limbScreen().find(l => l.limb === mv.limb);
            if (!ls) { why = 'sin-limb'; continue; }
            const rx = ls.x, ry = ls.y + 240 + intento * 40;
            fire(rx, ry); await sleep(200);
            if (!NS.grab(mv.limb)) { why = 'grab'; continue; }
            await sleep(250);
            fire(rx, ry + 30); await sleep(150);
            NS.grab(mv.limb);
            await sleep(500);
            const ancl1 = (NS.anchors() || []).some(a => a.limb === mv.limb);
            got = ancl0 && !ancl1;
            tele.push({i: intento, release: 'cursor', ancl0, ancl1});
          }
          if (!got) { why = 'no-suelto'; await sleep(800); }
        }
        log.push({m: m, limb: mv.limb, hold: '(release)', got: got, why: why, tele: tele});
        if (!got) break;
        // Tras soltar, el cuerpo pendula: esperar a que el amortiguamiento lo
        // asiente antes de la siguiente jugada (los ganchos exigen cadera asentada).
        await sleep(1800);
        continue;
      }
      for (let intento = 0; intento < 4 && !got; intento++) {
        if (intento > 0) await sleep(2000);
        else if (lastWasFootOrRelease) await sleep(1500);  // el pendulo se asienta antes del gancho
        const st0 = NS.state();
        if (st0 !== 'PLAYING' && st0 !== 'READY') { why = 'estado:' + st0; break; }
        // Drag residual de un intento anterior: cerrarlo SOLO si esta abierto
        // (grab() es un toggle: abrirlo a ciegas rompe el siguiente press).
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
          if (NS.dragging()) NS.grab(mv.limb);  // cierra solo si quedo abierto
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

def climb_stage(sid, max_restarts=5):
    ruta = RUTAS[sid]["moves"]
    hw = RUTAS[sid]["holds_world"]
    arr = []
    for l, h in ruta:
        if h == "":
            arr.append({"limb": l, "hold": "", "x": 0, "y": 0, "z": 0})  # release: soltar y colgar
        else:
            arr.append({"limb": l, "hold": h, "x": hw[h][0], "y": hw[h][1], "z": hw[h][2]})
    print(f"   ruta completa: {len(arr)} movimientos")
    for restart in range(1, max_restarts + 1):
        if not ev(f'JSON.stringify(window.__NS.load("{sid}"))'):
            print(f"      [reintento {restart}] no cargo {sid}")
            time.sleep(2)
            continue
        if not wait_state("READY", 25):
            print(f"      [reintento {restart}] no READY ({game_state()})")
            continue
        time.sleep(0.8)
        js = CLIMB_JS.replace("%RUTA%", json.dumps(arr))
        ab("eval", js)
        t0 = time.time()
        last_idx = -1
        timeout = 90 + 6 * len(arr)
        done = None
        while time.time() - t0 < timeout:
            c = ev('JSON.stringify(window.__climb || null)')
            if c:
                if c.get("idx", 0) >= last_idx + max(2, len(arr) // 4):
                    last_idx = c["idx"]
                    shot(f"circuito-full-{sid[-1]}-progreso-{restart}.png")
                if c.get("done"):
                    done = c
                    break
            time.sleep(2.5)
        if not done:
            print(f"      [reintento {restart}] timeout del lote ({game_state()})")
            continue
        got_n = sum(1 for r in done["log"] if r["got"])
        fails = [r for r in done["log"] if not r["got"]]
        print(f"      [reintento {restart}] {got_n}/{len(arr)} movimientos OK, estado={done.get('state')}")
        if fails:
            f0 = fails[0]
            print(f"      fallo en mov {f0['m']+1} {f0['limb']}->{f0['hold']} why={f0['why']}")
        if got_n >= max(2, len(arr) // 2):
            shot(f"circuito-full-{sid[-1]}-alto-{restart}.png")
        # Exito: SUCCESS (o ambas manos en cima por si la ventana de estabilidad tarda)
        t0 = time.time()
        while time.time() - t0 < 9:
            st = game_state()
            if st == "SUCCESS":
                break
            time.sleep(0.5)
        st = game_state()
        if st == "SUCCESS":
            ancl = ev('JSON.stringify(window.__NS.anchors())') or []
            top_hands = [a for a in ancl if a["limb"].startswith("hand") and a["hold"] == "top"]
            shot(f"circuito-full-{sid[-1]}-cima.png")
            print(f"      CIMA: SUCCESS con {len(top_hands)} manos en la presa cima -> {'OK' if len(top_hands)==2 else 'parcial'}")
            return len(top_hands) == 2
        if st in ("FALLEN", "TIMEOUT"):
            print(f"      caida/timeout tras el lote: {st}; recargando escenario...")
            continue
        # PLAYING sin exito y sin caida: recarga y reinicia (limpio desde el arranque)
        print(f"      lote terminado sin exito ({st}); recargando escenario...")
    return False

def main():
    stages = sys.argv[1:] if len(sys.argv) > 1 else STAGES
    ab("open", URL)
    time.sleep(2.5)
    ab("console", "--clear")
    import e2e_lib as lib
    lib.enter(ab)
    time.sleep(1.2)
    resultados = {}
    for sid in stages:
        print(f"== {sid} ({RUTAS[sid]['name']}) ==")
        ok = climb_stage(sid)
        resultados[sid] = ok
        print(f"   => {'RESUELTO' if ok else 'NO RESUELTO'}")
    errs = console_errors()
    print("\nConsola:", "limpia" if not errs else errs[:4])
    print("\n== RESUMEN ==")
    for sid, ok in resultados.items():
        print(f"   {sid}: {'OK - escalable de principio a fin' if ok else 'FALLA'}")
    if all(resultados.values()) and not errs:
        print("\nPASS: los 5 caminos del circuito son resolubles de punta a punta")
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
