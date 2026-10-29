#!/usr/bin/env python3
"""E2E Task 48 — VIDILLA EN LA PARED + CAOS VISIBLE + FIX DEL VUELO FANTASMA.

Tres peticiones del jugador en una:
  A. "a veces el ricachón se va volando estando la tabla completamente
     nivelada, como si fuese arrastrado por el viento" → FIX (latch
     richWalking + wobble sin sesgo): cubierto por unit tests (tabla.test.ts);
     aquí se verifica que la tabla nace y permanece sana con el ricachón
     comiendo/pataleando de fondo durante el arranque del E2E (plank.fell
     False sin tocar nada).
  B. "teníamos drones y pájaros que nunca he llegado a ver" → condiciones de
     spawn relajadas (gt 1,2 s, ventana dura 1,2 s, dron en fase 2,
     birdFrequencyMultiplier conectado): aquí se FUERZAN por el pipeline
     natural (debugForce → mismos caminos) y se capturan en pantalla.
  C. "introducir alguna planta saliendo de alguna depresión o hundimiento de
     la pared, para dar algo de vidilla a la subida" → vegetación nueva en
     los hundimientos (plantas.ts + scene): getReliefInfo().plants > 0 y
     capturas junto a un entrante real.

Pipeline: DATOS → GO → spawn → vegetación (spawn o re-cuelgados 'subir' hacia
entrantes) → capturas → cóndor → dron → tabla sana → 0 errores JS.
"""
import json, sys, time, urllib.request
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

def wait_for(page, cond, timeout_s, label, soft=False):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    if soft:
        return None
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return r.status, r.read()
    except Exception:
        return 0, b""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # ---------- 1) DATOS: vegetación + caos relajado ----------
    st, raw = get(f"{URL}/content/sherpas/wall_gen.json")
    assert st == 200, "wall_gen.json no servido"
    wg = json.loads(raw)
    veg = wg["relief"]["vegetacion"]
    assert veg["enabled"] is True, "vegetacion desactivada"
    assert veg["density"] > 0 and veg["keepFromHoldsM"] >= 0.3, f"vegetacion mal calibrada: {veg}"
    print(f"DATOS vegetacion: density={veg['density']} minDepth={veg['minDepthM']} keepFromHolds={veg['keepFromHoldsM']}")

    st, raw = get(f"{URL}/content/sherpas/events.json")
    assert st == 200
    ev = {e["id"]: e for e in json.loads(raw)["events"]}
    for eid in ("bird_pecker", "bird_thief", "condor", "cajas", "drone"):
        gt = [c.get("gt") for c in ev[eid]["conditions"] if c["type"] == "secondsSince"][0]
        assert gt is not None and gt <= 1.2, f"{eid}: condición imposible sigue (gt={gt})"
    assert ev["drone"]["weightByPhase"]["2"] > 0, "el dron sigue sin peso en fase 2"
    print("DATOS caos: pájaros/cóndor/cajas/dron con gt 1,2 s · dron también en fase 2")

    st, raw = get(f"{URL}/content/sherpas/difficulty.json")
    assert st == 200
    dif = json.loads(raw)["presets"]
    for k in ("tranquilo", "normal", "caos"):
        assert dif[k]["birdFrequencyMultiplier"] > 0, f"{k} sin multiplicador de aves"
    print("DATOS dificultad: birdFrequencyMultiplier presente (0.6/1.0/1.4)")

    # ---------- 2) partida ----------
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 40, "chunks de roca")

    # ---------- 3) VEGETACIÓN: nace en los hundimientos ----------
    # en el arranque puede que no haya entrante a la vista (banda de campamento):
    # re-cuelgados 'subir' hacia entrantes reales hasta contar matas y VER al
    # menos una proyectada DENTRO del encuadre (captura apuntada de verdad)
    def matas_en_cuadro():
        spots = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.plantas ? __SHERPAS_DEBUG.plantas() : []") or []
        visibles = []
        for s in spots:
            pr = page.evaluate(
                "(p => window.__SHERPAS_DEBUG.project(p.x, p.y, p.z))",
                {"x": s["x"], "y": s["y"], "z": s["z"]},
            )
            if pr and 0.05 < pr["x"] / page.viewport_size["width"] < 0.95 and 0.05 < pr["y"] / page.viewport_size["height"] < 0.95:
                visibles.append((s, pr))
        return visibles

    plants = 0
    visibles = []
    for attempt in range(9):
        q = probe(page) or {}
        plants = (q.get("relief") or {}).get("plants", 0)
        visibles = matas_en_cuadro()
        if plants > 0 and visibles:
            break
        ok = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')")
        if not ok:
            page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
        wait_for(page, lambda w: (w.get("relief") or {}).get("pending", 1) == 0 and (w.get("relief") or {}).get("chunks", 0) >= 3, 25, "chunks tras subir")
        page.wait_for_timeout(1500)
    assert plants > 0, "NINGUNA mata contada tras 8 re-cuelgados hacia entrantes"
    assert visibles, f"{plants} matas vivas pero NINGUNA en el encuadre"
    s, pr = visibles[0]
    print(f"VEGETACIÓN: {plants} matas vivas · una a {pr['x']:.0f},{pr['y']:.0f} px (escala {s['scale']:.2f})")
    page.wait_for_timeout(700)  # asienta la frame tras los rebuilds
    page.screenshot(path=f"{OUT}/t48-0-plantas-pared.png")
    print("CAPTURA t48-0-plantas-pared.png")

    # el número de matas NO se desmadra (anti-jungla por chunk y global)
    assert plants <= 80 * 10, f"jungla: {plants} matas"

    # ---------- 4) PÁJAROS VISIBLES: cóndor por el pipeline real ----------
    condor_ok = False
    for attempt in range(3):
        if page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('condor')"):
            condor_ok = True
            break
        page.wait_for_timeout(1200)
    assert condor_ok, "spawn del cóndor falló"
    page.wait_for_timeout(3200)  # aproximación + sombra visible
    p = probe(page)
    page.screenshot(path=f"{OUT}/t48-1-condor.png")
    print("CAPTURA t48-1-condor.png (ave por el pipeline de spawn)")

    # ---------- 5) DRON VISIBLE ----------
    drone_ok = False
    for attempt in range(3):
        if page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('drone')"):
            drone_ok = True
            break
        page.wait_for_timeout(1200)
    assert drone_ok, "spawn del dron falló"
    d = wait_for(page, lambda q: q.get("drone") and q["drone"]["phase"] in ("approach", "hover"), 10, "dron en vuelo")
    print(f"DRON VUELA  phase={d['drone']['phase']} kg={d['drone']['kg']}")
    page.screenshot(path=f"{OUT}/t48-2-dron.png")
    print("CAPTURA t48-2-dron.png")

    # ---------- 6) FIX VUELO FANTASMA: tabla sana sin tocar nada ----------
    # el ricachón come/insulta/patalea de fondo (director activo tras el fix);
    # la tabla NUNCA escora sola con nivel (el latch richWalking ya no muere)
    wait_for(page, lambda q: q.get("drone") and q["drone"]["phase"] in ("hover", "delivered"), 25, "entrega del paquete", soft=True)
    p = wait_for(page, lambda q: q.get("plank") is not None, 8, "plank")
    pk = wait_for(page, lambda q: q.get("plank") and not q["plank"]["fell"], 10, "tabla sin caída")
    print(f"TABLA SANA: tilt={pk['plank']['tiltDeg']}° slide={pk['plank']['slide']} fell={pk['plank']['fell']} rich={pk['rich']['state']}")
    assert pk["plank"]["fell"] is False, "el ricachón se cayó SOLO al arrancar (regresión del vuelo fantasma)"

    # ---------- 7) sin errores JS ----------
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T48 VERDE ✅")
    browser.close()
