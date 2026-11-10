#!/usr/bin/env python3
"""E2E T86 — verificación en vivo del nivel ?nivel=pared:
  1) VALLE: el amarre del ricachón coincide con el nodo MÁS BAJO del arco de
     la cuerda (no con el nudo medio) y los pies cuelgan bajo él (tirantes).
  2) MANOS PRIORITARIAS (zona 2): arrastrar la mano a una presa más alta que
     no llega con los pies anclados → el juego suelta el pie y la mano acaba
     EXACTAMENTE en la presa (distancia ~0) — el cuerpo subió.
  3) DESLIZAMIENTO: tras la subida, el valle/amarre se desplazan hacia el
     sherpa más bajo y siguen pegados a la cuerda.
"""
import os
import subprocess
import time
import sys
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download/T86-capturas"


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


def sonda(page):
    return page.evaluate("window.__PARED.sonda()")


def avanza_sim(page, segundos, max_ms=20000):
    """Avanza la simulación en la página tick a tick (determinista): el rAF
    con SwiftShader va a <1 fps y el acumulador puede quedar en déficit."""
    return page.evaluate("""((seg) => {
      const P = __PARED;
      const dt = P.d.data.tuning.tick.fixedDeltaSeconds;
      const objetivo = P.simTime + seg;
      let n = 0;
      while (P.simTime < objetivo && n < 4000) { P.simTick(dt); n++; }
      return { sim: +P.simTime.toFixed(2), ticks: n };
    })""", segundos)


def espera(page, cond, segs, paso=250):
    t0 = time.time()
    while time.time() - t0 < segs:
        try:
            s = sonda(page)
            if cond(s):
                return s
        except Exception:
            pass
        page.wait_for_timeout(paso)
    return None


srv = start_servers()
os.makedirs(OUT, exist_ok=True)
errores_js = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ])
        ctx = browser.new_context(viewport={"width": 800, "height": 450})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errores_js.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        if not espera(page, lambda s: s["bloques"] > 0 and s["anclajes"][0] >= 4, 140):
            print("FALLO arranque", errores_js[:4])
            sys.exit(1)
        print("OK nivel arriba", flush=True)
        # la cuerda asienta con el lastre: esperamos en TIEMPO SIM (t > 10 s),
        # el reloj real corre más rápido que la sim bajo SwiftShader
        r = avanza_sim(page, 12)
        print(f"OK sim asentada: {r}", flush=True)

        # ---------- 1) VALLE: amarre == valle del arco; pies colgando ----------
        s = sonda(page)
        r = s["ricachon"]
        print(f"ricachon: nudoY={r['nudoY']:.2f} valleY={r['valleY']:.2f} nudoX={r['nudoX']:.2f} valleX={r['valleX']:.2f} piesY={r['piesY']:.2f}", flush=True)
        assert abs(r["nudoX"] - r["valleX"]) < 0.55, "el amarre no está en el valle del arco"
        assert abs(r["nudoY"] - r["valleY"]) < 0.6, "el amarre no está pegado a la cuerda"
        assert r["piesY"] < r["nudoY"] + 0.05, "los pies no cuelgan bajo el amarre"
        assert r["cabezaY"] < r["nudoY"], "el cuerpo no cuelga boca abajo"
        page.screenshot(path=f"{OUT}/t86-1-valle.png")
        print("OK amarre EN EL VALLE del arco, boca abajo con tirantes", flush=True)

        # ---------- 2) MANOS PRIORITARIAS: mano a presa que exige soltar pie ----------
        objetivo = page.evaluate("""(() => {
          const P = __PARED;
          const rig = P.sherpas[0];
          const anchors = rig.deps.anchorSystem;
          const waist = rig.waist();
          const hand = rig.limbPos('hand_r');
          // presa libre MÁS ALTA por encima de la mano (a 0,9..1,7 m: exige soltar pie)
          let best = null;
          for (const h of anchors.holds.values()) {
            if (anchors.anchorAtHold(h.id)) continue;
            const dy = h.pos.y - hand.y;
            if (dy < 0.9 || dy > 1.7) continue;
            if (Math.abs(h.pos.x - hand.x) > 1.4) continue;
            if (!best || h.pos.y > best.pos.y) best = h;
          }
          if (!best) return null;
          const sp = P.d.scene.projectToScreenCss(best.pos);
          const hp = P.d.scene.projectToScreenCss(hand);
          const cv = P.d.scene.engine.getRenderingCanvas();
          const px = (v) => ({ x: (v.x / 100) * cv.clientWidth, y: (v.y / 100) * cv.clientHeight });
          return { hold: best.id, destino: px(sp), mano: px(hp),
                   anclajesAntes: rig.anchorsCount(), manoY: hand.y, pies: {
                     l: !!rig.states.get('foot_l').anchored, r: !!rig.states.get('foot_r').anchored } };
        })()""")
        assert objetivo, "sin presa alta de prueba para la mano"
        print(f"destino: {objetivo['hold']} · pies anclados {objetivo['pies']} · anclajes {objetivo['anclajesAntes']}", flush=True)
        # re-proyecta la mano JUSTO antes del clic (el sherpa respira/mueve)
        objetivo["mano"] = page.evaluate("""(() => {
          const P = __PARED;
          const hand = P.sherpas[0].limbPos('hand_r');
          const hp = P.d.scene.projectToScreenCss(hand);
          const cv = P.d.scene.engine.getRenderingCanvas();
          return { x: (hp.x / 100) * cv.clientWidth, y: (hp.y / 100) * cv.clientHeight };
        })()""")
        # el radio de la mochila (52 px) puede absorber el clic de la mano en
        # este viewport: neutralizamos SU hit-test solo durante el arrastre
        page.evaluate("window.__bpAtOrig = __PARED.d.scene.backpackAt.bind(__PARED.d.scene); __PARED.d.scene.backpackAt = () => null")
        page.mouse.move(objetivo["mano"]["x"], objetivo["mano"]["y"])
        page.mouse.down()
        # arrastre en pasitos hacia la presa (el imán + empuje de pierna actúan)
        pasos = 14
        for i in range(1, pasos + 1):
            x = objetivo["mano"]["x"] + (objetivo["destino"]["x"] - objetivo["mano"]["x"]) * i / pasos
            y = objetivo["mano"]["y"] + (objetivo["destino"]["y"] - objetivo["mano"]["y"]) * i / pasos
            page.mouse.move(x, y, steps=2)
            page.wait_for_timeout(70)
        page.wait_for_timeout(250)
        sdrag = sonda(page)
        piesTrasDrag = page.evaluate("""(() => {
          const r0 = __PARED.sherpas[0], r1 = __PARED.sherpas[1];
          const st = (rig) => Object.fromEntries(['hand_l','hand_r','foot_l','foot_r'].map((l) => {
            const s = rig.states.get(l);
            return [l, s.anchored ? (s.holdId||'').slice(-3) : (s.traveling ? 'TV' : '-')];
          }));
          return { dragging0: r0.dragging, dragging1: r1.dragging,
                   magnet0: r0.dragMagnetId(), magnet1: r1.dragMagnetId(),
                   st0: st(r0), st1: st(r1), rope: [r0.ropeState, r1.ropeState] };
        })()""")
        print("DRAG:", piesTrasDrag, flush=True)
        print(f"tras arrastre: drag0={piesTrasDrag['dragging0']} imán={piesTrasDrag['magnet0']} st0={piesTrasDrag['st0']}", flush=True)
        page.mouse.up()
        page.evaluate("__PARED.d.scene.backpackAt = window.__bpAtOrig")
        avanza_sim(page, 3)  # el viaje determinista completa en la sim
        fin = page.evaluate("""(() => {
          const rig = __PARED.sherpas[0];
          const st = rig.states.get('hand_r');
          const hold = st.holdId ? rig.deps.anchorSystem.holds.get(st.holdId) : null;
          const dist = hold ? Math.hypot(rig.limbPos('hand_r').x - hold.pos.x, rig.limbPos('hand_r').y - hold.pos.y) : null;
          return { holdId: st.holdId, anclajes: rig.anchorsCount(), dist,
                   manoY: rig.limbPos('hand_r').y, waistY: rig.waist().y };
        })()""")
        print(f"agarre final: hold={fin['holdId']} dist={fin['dist'] and round(fin['dist'],4)} anclajes={fin['anclajes']} manoY {objetivo['manoY']:.2f}→{fin['manoY']:.2f} (subió {fin['manoY']-objetivo['manoY']:+.2f} m)", flush=True)
        # T86: la mano acaba SIEMPRE PERFECTAMENTE COLOCADA en SU presa (la que
        # marca el imán; si el bloque basculó, la presa marcada manda por id)
        assert fin["holdId"] == objetivo["hold"], f"la mano no acabó en la presa marcada: {fin['holdId']}"
        assert fin["dist"] is not None and fin["dist"] < 0.02, f"la mano no está EXACTAMENTE en la presa: {fin['dist']}"
        assert fin["manoY"] > objetivo["manoY"] + 0.5, "la mano no subió a la presa alta"
        print(f"OK mano PERFECTA en la presa · pies tras el empuje: {piesTrasDrag['st0']['foot_l']}/{piesTrasDrag['st0']['foot_r']} (antes {objetivo['pies']['l']}/{objetivo['pies']['r']})", flush=True)
        page.screenshot(path=f"{OUT}/t86-2-mano-perfecta.png")

        # ---------- 3) DESLIZAMIENTO del valle tras la subida ----------
        avanza_sim(page, 8)
        s3 = sonda(page)
        r3 = s3["ricachon"]
        print(f"valle tras subida: valleX {r['valleX']:.2f} → {r3['valleX']:.2f} · nudoX {r['nudoX']:.2f} → {r3['nudoX']:.2f} · nudoY {r['nudoY']:.2f} → {r3['nudoY']:.2f}", flush=True)
        # la invariante correcta: el amarre cuelga A LA ALTURA del valle (el
        # fondo del arco puede ser plano: dos nodos a la misma cota) y se ha
        # DESPLAZADO hacia el sherpa más bajo (el 0 subió → el valle va hacia el 1)
        assert abs(r3["nudoY"] - r3["valleY"]) < 0.45, f"el amarre no cuelga a la cota del valle: {r3['nudoY']} vs {r3['valleY']}"
        # desplazamiento esperado por la fórmula (dif·0.22, tope 0.45 del vano)
        esperado = min(0.45, max(0.0, (3.08 - 1.93)) * 0.22) * 2.6
        assert r3["nudoX"] > r["nudoX"] + max(0.15, esperado * 0.55), f"el amarre no deslizó hacia el sherpa más bajo: {r['nudoX']} → {r3['nudoX']} (esperado +{esperado:.2f})"
        assert r3["piesY"] < r3["nudoY"] + 0.05, "los pies dejaron de colgar del amarre"
        page.screenshot(path=f"{OUT}/t86-3-valle-seguimiento.png")

        print(f"estado={s3['state']} errores JS={len(errores_js)}", flush=True)
        assert not errores_js, f"errores JS: {errores_js[:3]}"
        print("E2E T86 VERDE", flush=True)
finally:
    srv.kill()
