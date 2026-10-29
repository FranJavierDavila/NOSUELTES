#!/usr/bin/env python3
"""E2E Task 40 — ROCA ESTRATIFICADA (campo de altura fractal).
Petición del jugador:
  - "El patrón Voronoi no parece una rotura natural": se sustituye la
    teselación por un CAMPO DE ALTURA estratificado (fBm + ridged + warp).
  - "Color uniforme con variaciones ligeras de tono y rugosidad simulando
    piedra, incluso texturizarla con mapas de roca": textura procedural.
  - "Las líneas verticales grises de arriba a abajo deben eliminarse": fuera
    aristas dibujadas (enableEdgesRendering) y grietas polilínea falsas.
  - "Una gran roca creíble con salientes y entrantes": el campo forma los
    volúmenes; las presas descansan SOBRE la roca (aplanado por anclaje).
Pipeline: spawn (sonda relief: algorithm/chunks/tris) → capturas → subir ×N
(streaming visible-only) → regresión de escalada + perf + 0 errores JS.
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

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.screenshot(path=f"{OUT}/t40-0-menu.png")
    print("CAPTURA t40-0-menu.png (pared del menú con roca estratificada)")
    page.click("button[data-a=go]")

    # 1) SPAWN: roca estratificada construida alrededor de la cámara
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    r = wait_for(page, lambda q: q.get("relief") and q["relief"]["chunks"] > 0 and q["relief"]["tris"] > 0, 15, "roca en spawn")
    ri = r["relief"]
    print(f"ROCA algoritmo={ri['algorithm']}  chunks={ri['chunks']}  verts={ri['cells']}  tris={ri['tris']}  banda={ri['viewBand']}")
    assert ri["algorithm"] == "estratificada", f"algoritmo inesperado: {ri}"
    assert ri["chunks"] <= 9, f"presupuesto LRU excedido: {ri['chunks']}"
    assert ri["tris"] < 62000, f"presupuesto de triángulos excedido: {ri['tris']}"
    perf0 = r.get("perf", {})
    print(f"PERF spawn fps={perf0.get('fps')}  frameMs={perf0.get('frameTimeMs')}  drawCalls={perf0.get('drawCalls')}")
    band0 = ri["viewBand"]; builds0 = ri["builds"]
    page.wait_for_timeout(700)  # drena cola de chunks pendientes
    page.screenshot(path=f"{OUT}/t40-1-spawn.png")
    print("CAPTURA t40-1-spawn.png")

    # 2) SUBIDA: los chunks SIGUEN a la cámara y la escalada funciona
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
    page.screenshot(path=f"{OUT}/t40-2-subida.png")
    print("CAPTURA t40-2-subida.png")

    # 3) PERF: sin regresión estructural. NOTA: el Chromium headless de este
    # entorno rasteriza POR SOFTWARE (SwiftShader): el baseline pre-T40 con
    # Voronoi ya era ~5 fps / ~190 ms frame — lo que se vigila es que la roca
    # estratificada NO empeore el presupuesto (tris/meshes/frameMs), no el
    # fps absoluto del renderer software (en GPU real 46k tris es trivial).
    perf = p2.get("perf", {})
    print(f"PERF en altura fps={perf.get('fps')}  frameMs={perf.get('frameTimeMs')}  drawCalls={perf.get('drawCalls')}  meshes={perf.get('meshes')}")
    assert perf.get("meshes", 9999) < 1200, f"explosión de mallas: {perf.get('meshes')}"
    assert (perf.get("frameTimeMs") or 9999) < 400, f"frameMs catastrófico: {perf.get('frameTimeMs')}"

    # 4) CERO errores JS en todo el recorrido
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 errores JS")

    browser.close()
    print("E2E T40 COMPLETO EN VERDE")
