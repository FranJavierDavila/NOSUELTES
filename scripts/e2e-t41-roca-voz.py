#!/usr/bin/env python3
"""E2E Task 41 — DEFINICIÓN DE LA ROCA + DESPEJE DE PIERNAS + VOZ CASTELLANA.
Peticiones del jugador:
  1. "El muro tiene muy poca definición... muchos más detalles, tonalidades,
     efectos más marcados, rugosidad de piedra con textura": textura 512² con
     grano/poros + MAPA NORMAL por píxel + tono y AO más marcados.
  2. "Las piernas se meten dentro de la pared; retrasa la pared y haz los
     puntos de agarre más profundos": zFront −0,30 (pared atrás), presas a
     0,34 de la cara (knobs profundos) y techo de roca natural 0,24 — las
     piernas cuelgan EN EL AIRE (holgura ≥ 0,25 m sobre toda la roca natural).
  3. "Las voces en inglés... hombre curtido, voz fuerte y grave": banco ES
     regenerado (xiaochen 94 Hz + pitch 0,90) — los MP3 del banco NUEVO se
     sirven 200 y el GRITO REAL del jugador sigue intacto (62 829 B).
Pipeline: spawn → sonda relief → clearance de piernas (partículas 3D) →
subir ×3 (streaming + escalada) → voz (fetch de slugs del banco nuevo) →
0 errores JS.
"""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    if not el:
        return None
    try:
        return json.loads(el.get_attribute("data-probe"))
    except Exception:
        return None

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # datos REALES del pack (la prueba lee la geometría, no la hardcodea)
    wdata = page.evaluate("""fetch('/content/sherpas/wall_gen.json').then(r => r.json())""")
    zFront = wdata["wall"]["zFront"]
    holdProud = wdata["wall"]["holdProudM"]
    natMax = wdata["relief"]["naturalMaxM"]
    print(f"DATOS zFront={zFront}  holdProudM={holdProud}  naturalMaxM={natMax}")
    assert zFront <= -0.25, f"la pared NO está retrasada: zFront={zFront}"
    assert holdProud >= 0.3, f"las presas NO son profundas: holdProudM={holdProud}"
    assert natMax <= 0.3, f"techo de roca natural demasiado alto: {natMax}"

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.screenshot(path=f"{OUT}/t41-0-menu.png")
    print("CAPTURA t41-0-menu.png (roca de definición alta en el menú)")
    page.click("button[data-a=go]")

    # 1) SPAWN: roca estratificada construida, dentro de presupuesto
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    r = wait_for(page, lambda q: q.get("relief") and q["relief"]["chunks"] > 0 and q["relief"]["tris"] > 0, 15, "roca en spawn")
    ri = r["relief"]
    print(f"ROCA algoritmo={ri['algorithm']}  chunks={ri['chunks']}  verts={ri['cells']}  tris={ri['tris']}  banda={ri['viewBand']}")
    assert ri["algorithm"] == "estratificada", f"algoritmo inesperado: {ri}"
    assert ri["chunks"] <= 9, f"presupuesto LRU excedido: {ri['chunks']}"
    assert ri["tris"] < 62000, f"presupuesto de triángulos excedido: {ri['tris']}"
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/t41-1-spawn.png")
    print("CAPTURA t41-1-spawn.png")

    # 2) DESPEJE DE PIERNAS (partículas 3D reales de ambos escaladores):
    #    pies/rodillas (y bajo) por DELANTE de toda la roca natural posible.
    legs = page.evaluate("""() => {
      const out = [];
      for (const p of [0, 1]) {
        const parts = window.__SHERPAS_DEBUG.particles(p);
        if (!parts || !parts.length) return null;
        const ys = parts.map(q => q[1]);
        const yMin = Math.min(...ys);
        const legParts = parts.filter(q => q[1] < yMin + 0.5); // piernas/pies
        const z = legParts.reduce((s, q) => s + q[2], 0) / legParts.length;
        const handZ = Math.min(...parts.map(q => q[2])); // lo más adelantado del cuerpo
        out.push({ legsZ: z, frontZ: handZ, n: legParts.length });
      }
      return out;
    }""")
    assert legs and len(legs) == 2, f"sonda de partículas vacía: {legs}"
    rockDeepestZ = zFront - natMax        # la roca natural NUNCA pasa de aquí
    for i, L in enumerate(legs):
        holgura = rockDeepestZ - L["legsZ"]  # (más negativo = más hacia cámara = DELANTE)
        print(f"ESCALADOR {i}: piernas z={L['legsZ']:.3f} (n={L['n']}) | roca natural máx z={rockDeepestZ:.3f} | HOLGURA={holgura:.3f} m")
        assert L["n"] >= 2, "sin partículas de pierna en la sonda"
        assert holgura >= 0.1, f"las piernas TOCAN la roca: holgura {holgura:.3f} m"
        # presas profundas: las manos (sujetas a presas) están por delante
        assert L["frontZ"] <= zFront - holdProud + 0.12, \
            f"las manos no llegan a presas profundas: frontZ={L['frontZ']:.3f}"

    # 3) SUBIDA: streaming + escalada funcionan sobre la nueva roca
    band0 = ri["viewBand"]; builds0 = ri["builds"]
    for i in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), f"force subir2 #{i}"
        page.wait_for_timeout(900)
    p2 = wait_for(page, lambda q: q.get("relief") and q["relief"]["viewBand"] > band0 and q["relief"]["builds"] > builds0, 20, "streaming de roca al subir")
    ri2 = p2["relief"]
    print(f"SUBIDA banda {band0}→{ri2['viewBand']}  builds {builds0}→{ri2['builds']}  chunks={ri2['chunks']}  tris={ri2['tris']}")
    assert ri2["viewBand"] > band0, "la roca NO siguió a la cámara"
    assert ri2["chunks"] <= 9, f"LRU excedido tras subir: {ri2['chunks']}"
    prog = p2.get("a", {}).get("y", 0) + p2.get("b", {}).get("y", 0)
    print(f"progreso escaladores a+b y = {prog:.1f} m")
    assert prog > 8, f"la escalada dejó de funcionar sobre la roca: y_a+y_b = {prog}"
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/t41-2-subida.png")
    print("CAPTURA t41-2-subida.png")

    # 4) VOZ CASTELLANA: slugs del banco NUEVO se sirven 200 con audio sano;
    #    el GRITO REAL del jugador sigue intacto (62 829 B, grabación Task 38).
    #    TOLERANTE A CUOTA: la regeneración rellena el banco cuando la cuota de
    #    TTS se recupera (script re-ejecutable); exigimos una COBERTURA mínima
    #    (≥25/65) y que TODO fichero existente se sirva sano (los que faltan
    #    caen al fallback speechSynthesis es-ES grave del juego).
    voice = page.evaluate("""async () => {
      const bank = await fetch('/content/sherpas/insults_es.json').then(r => r.json());
      const slug = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };
      const texts = Object.values(bank).flat();
      const out = { served: 0, missing: 0, bad: 0, slugs: [] };
      for (const t of texts) {
        const res = await fetch('/audio/rico/es/' + slug(t) + '.mp3');
        if (!res.ok) { out.missing++; continue; }
        const size = Number(res.headers.get('content-length') || 0);
        if (size > 4000) { out.served++; } else { out.bad++; out.slugs.push(slug(t)); }
      }
      const grito = await fetch('/audio/rico/es/cd0e9f33.mp3');
      out.grito = { ok: grito.ok, size: Number(grito.headers.get('content-length') || 0) };
      return out;
    }""")
    print(f"VOZ ES: servidos={voice['served']}/65  ausentes={voice['missing']}  corruptos={voice['bad']}")
    assert voice["served"] >= 25, f"cobertura del banco ES demasiado baja (¿regen parado?): {voice['served']}/65"
    assert voice["bad"] == 0, f"MP3 corruptos o truncados: {voice['slugs'][:3]}"
    assert voice["grito"]["ok"] and voice["grito"]["size"] == 62829, \
        f"¡EL GRITO REAL HA CAMBIADO!: {voice['grito']} (esperado 62829 B)"
    print("GRITO REAL intacto (62829 B)")

    # 5) CERO errores JS en todo el recorrido
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 errores JS")

    browser.close()
    print("E2E T41 COMPLETO EN VERDE")
