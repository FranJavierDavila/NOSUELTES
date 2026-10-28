#!/usr/bin/env python3
"""E2E Task 39 — RELIEVE POR TESELACIÓN (Voronoi / fracturación tectónica).
Petición del jugador:
  - "Una función que genere patrones de muros mediante algoritmos de rotura
    (Diagramas de Voronoi o fracturación tectónica)": el muro deja de ser
    plano — piedras poligonales con NIVELES de extrusión y juntas de mortero.
  - "El tramo visible por la cámara se construye con formas poligonales,
    optimizando al máximo su dibujado": STREAMING de chunks alrededor de la
    cámara (LRU con presupuesto) — al subir, los chunks siguen a la cámara.
  - "Los anclajes se colocan sobre las caras de esos polígonos, centrando las
    caras en ellos y rompiendo a su alrededor": los chunks se reconstruyen al
    llegar presas nuevas (semillas de anclaje) y la escalada sigue funcionando.
Pipeline: spawn (sonda relief: chunks/cells/tris) → captura → subir2 ×N (los
chunks siguen a la cámara: viewBand sube, builds crece) → captura en altura →
regresión rápida de escalada (presas alcanzables, 0 errores JS).
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

def sub_txt(page):
    try:
        return (page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or "").strip()
    except Exception:
        return ""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # menú → partida (el FONDO del menú ya es la pared con relieve: captura)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.screenshot(path=f"{OUT}/t39-0-menu.png")
    print("CAPTURA t39-0-menu.png (pared del menú con relieve)")
    page.click("button[data-a=go]")

    # 1) SPAWN: relieve construido alrededor de la cámara
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    r = wait_for(page, lambda q: q.get("relief") and q["relief"]["chunks"] > 0 and q["relief"]["cells"] > 0 and q["relief"]["tris"] > 0, 15, "relieve en spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}")
    print(f"RELIEVE algoritmo={r['relief']['algorithm']}  chunks={r['relief']['chunks']}  piedras={r['relief']['cells']}  tris={r['relief']['tris']}  banda={r['relief']['viewBand']}")
    perf0 = r.get("perf", {})
    print(f"PERF spawn fps={perf0.get('fps')}  frameMs={perf0.get('frameTimeMs')}  drawCalls={perf0.get('drawCalls')}  meshes={perf0.get('meshes')}  escala={perf0.get('scale')}")
    assert r["relief"]["algorithm"] == "voronoi", f"algoritmo inesperado: {r['relief']}"
    assert r["relief"]["chunks"] <= 9, f"presupuesto LRU excedido: {r['relief']['chunks']}"
    band0 = r["relief"]["viewBand"]
    builds0 = r["relief"]["builds"]
    page.screenshot(path=f"{OUT}/t39-1-spawn.png")
    print("CAPTURA t39-1-spawn.png")

    # 2) SUBIDA: los chunks SIGUEN a la cámara (streaming) y la escalada funciona
    for i in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), f"force subir2 #{i}"
        page.wait_for_timeout(900)
    p2 = wait_for(page, lambda q: q.get("relief") and q["relief"]["viewBand"] > band0 and q["relief"]["builds"] > builds0, 20, "streaming de relieve al subir")
    r2 = p2["relief"]
    print(f"SUBIDA banda {band0}→{r2['viewBand']}  builds {builds0}→{r2['builds']}  chunks={r2['chunks']}  piedras={r2['cells']}  tris={r2['tris']}")
    assert r2["viewBand"] > band0, "el relieve NO siguió a la cámara"
    assert r2["chunks"] <= 9, f"LRU excedido tras subir: {r2['chunks']}"
    # el progreso de escalada es real (presas alcanzables sobre las piedras)
    prog = p2.get("a", {}).get("y", 0) + p2.get("b", {}).get("y", 0)
    print(f"progreso escaladores a+b y = {prog:.1f} m")
    assert prog > 8, f"la escalada dejó de funcionar sobre el relieve: y_a+y_b = {prog}"
    page.screenshot(path=f"{OUT}/t39-2-subida.png")
    print("CAPTURA t39-2-subida.png")

    # 3) PERF: sin regresión estructural (meshes acotados: incluyen ~500+ instancias
    # de presas por diseño de tareas anteriores; el relieve añade ≤ maxChunks losas)
    perf = p2.get("perf", {})
    print(f"PERF en altura fps={perf.get('fps')}  frameMs={perf.get('frameTimeMs')}  drawCalls={perf.get('drawCalls')}  meshes={perf.get('meshes')}  activas={perf.get('activeMeshes')}  escala={perf.get('scale')}")
    assert perf.get("meshes", 9999) < 1200, f"explosión de mallas: {perf.get('meshes')}"
    assert r2["chunks"] <= 9 and r2["tris"] < 60000, f"relieve sin presupuesto: {r2}"

    # 4) CERO errores JS en todo el recorrido
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 errores JS")

    browser.close()
    print("E2E T39 COMPLETO EN VERDE")
