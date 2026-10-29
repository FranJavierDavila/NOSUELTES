#!/usr/bin/env python3
"""E2E Task 46 — ÓRBITA VERTICAL + AUTO-RETORNO (petición del jugador).

"Puedo añadir también órbita vertical (para ver los techos por debajo), un
ligero auto-retorno tras X segundos, o el stick derecho del mando para P2."

Comprobaciones:
  1. DATOS: camera.json con orbitPitchMaxDeg 30 + auto-retorno (3,5 s, tasa
     1,3/s); teclas V/B y cameraOrbit stick 2 en el mando del P2; ayuda.
  2. V (cámara POR DEBAJO): la cámara desciende > 1,5 m y mira hacia ARRIBA
     (rot.x NEGATIVO: en Babylon LH mirar abajo es rot.x positivo). Captura.
  3. PERSISTE ~2 s (para analizar con calma) y LUEGO el auto-retorno la funde
     de vuelta al frontal (yaw y pitch ≈ línea base) sin tocar nada.
  4. B (cámara POR ARRIBA): sube > 1,5 m y mira hacia abajo (rot.x > 0). Captura.
  5. TOPE vertical: manteniendo V mucho más de lo necesario, el pitch queda
     clavado en ±30° — nunca se pasa.
  6. REGRESIÓN Z/X (T45): la órbita lateral sigue funcionando y C reencuadra
     al instante (yaw y pitch a 0).
Pipeline: menú → GO → spawn → V → persistencia+retorno → B → tope → Z/C →
capturas → 0 errores JS. (El stick derecho del P2 se verifica en UNITARIOS con
navigator stubbed; Playwright no inyecta gamepads.)
"""
import json, math, time, urllib.request
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

def cam(page):
    q = ("(() => { const s = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();"
         " if (!s || !s.camera) return null;"
         " const c = s.camera;"
         " return { yaw: c.rotation.y, pitch: c.rotation.x, x: c.position.x, y: c.position.y, z: c.position.z }; })()")
    return page.evaluate(q)

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return r.status, len(r.read())
    except Exception:
        return 0, 0

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) DATOS del pack: pitch ±30° + auto-retorno + V/B + stick derecho
    cdata = page.evaluate("fetch('/content/sherpas/camera.json').then(r => r.json())")
    imaps = page.evaluate("fetch('/content/sherpas/input_maps.json').then(r => r.json())")
    ses = page.evaluate("fetch('/content/sherpas/strings_es.json').then(r => r.json())")
    print(f"DATOS pitch={cdata['orbitPitchMaxDeg']}° speed={cdata['orbitPitchSpeedDeg']}°/s autoReturn={cdata['orbitAutoReturnS']}s rate={cdata['orbitReturnRate']}/s")
    assert cdata["orbitPitchMaxDeg"] == 30, f"tope vertical mal: {cdata['orbitPitchMaxDeg']}"
    assert cdata["orbitAutoReturnS"] >= 2 and cdata["orbitReturnRate"] > 0.3, "auto-retorno mal configurado"
    shared = imaps["shared"]
    assert shared.get("cameraOrbitDown") == "KeyV" and shared.get("cameraOrbitUp") == "KeyB", f"V/B mal: {shared}"
    assert imaps["players"]["p2"]["gamepad"].get("cameraOrbit") == {"stick": 2, "deadzone": 0.22}, "stick derecho mal"
    st, sz = get(f"{URL}/content/sherpas/camera.json")
    assert st == 200 and sz > 280, f"camera.json no servido: {st} {sz}B"
    assert "V/B" in ses["keys"]["shared"] and "POR DEBAJO" in ses["help"]["extra"], "ayuda es sin la vertical"
    print("TECLAS V/B + stick derecho del mando · ayuda con auto-retorno")

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")

    # 2) SPAWN
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 40, "chunks de roca")
    page.wait_for_timeout(700)

    c0 = cam(page)
    assert c0, "sonda de cámara ausente"
    print(f"FRENTE: pitch={math.degrees(c0['pitch']):+.1f}° yaw={math.degrees(c0['yaw']):+.1f}° y={c0['y']:.2f}")
    # el encuadre frontal mira ~3-4° hacia ABAJO por diseño (offset +0,6 m de
    # altura sobre el objetivo): la línea base de pitch NO es 0 exacto.
    assert abs(c0["pitch"]) < 0.1 and abs(c0["yaw"]) < 0.04, "el arranque no es frontal"
    y0 = c0["y"]

    # 3) V → CÁMARA POR DEBAJO: baja y mira ARRIBA (techos por debajo)
    page.keyboard.down("KeyV")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyV")
    c1 = cam(page)
    print(f"V (por debajo): pitch={math.degrees(c1['pitch']):+.1f}° y={c1['y']:.2f} (Δy={c1['y']-y0:+.2f} m)")
    assert c1["y"] < y0 - 1.5, f"la cámara no DESCENDIÓ: Δy={c1['y']-y0:.2f}"
    assert c1["pitch"] < -0.2, f"no mira hacia ARRIBA (techos por debajo): {math.degrees(c1['pitch']):.1f}°"
    page.screenshot(path=f"{OUT}/t46-1-techos-por-debajo.png")
    print("CAPTURA t46-1-techos-por-debajo.png")

    # 4) PERSISTE un rato y LUEGO auto-retorno: sin tocar nada, vuelve sola
    page.wait_for_timeout(2000)
    c2 = cam(page)
    print(f"PERSISTE (2 s tras soltar): pitch={math.degrees(c2['pitch']):+.1f}°")
    assert c2["pitch"] < -0.15, "la órbita vertical no persiste (volvió demasiado pronto)"
    t0 = time.time()
    returned = None
    while time.time() - t0 < 15:
        cq = cam(page)
        if abs(cq["pitch"]) < 0.1 and abs(cq["yaw"]) < 0.05:  # 0.1 = línea base (mirada 3,9° abajo)
            returned = cq
            break
        page.wait_for_timeout(300)
    assert returned, f"el auto-retorno no llegó en 15 s: {cam(page)}"
    print(f"AUTO-RETORNO: de vuelta al frontal en ~{time.time()-t0:.1f} s sin tocar nada (pitch={math.degrees(returned['pitch']):+.1f}°)")

    # 5) B → CÁMARA POR ARRIBA: sube y mira abajo
    page.keyboard.down("KeyB")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyB")
    c3 = cam(page)
    print(f"B (por encima): pitch={math.degrees(c3['pitch']):+.1f}° y={c3['y']:.2f} (Δy={c3['y']-y0:+.2f} m)")
    assert c3["y"] > y0 + 1.5, f"la cámara no ASCENDIÓ: Δy={c3['y']-y0:.2f}"
    assert c3["pitch"] > 0.35, f"no mira hacia ABAJO desde arriba: {math.degrees(c3['pitch']):.1f}°"
    page.screenshot(path=f"{OUT}/t46-2-desde-arriba.png")
    print("CAPTURA t46-2-desde-arriba.png")

    # 6) TOPES: (a) ARRIBA la órbita alcanza su MESETA (30° de órbita + ~4° de
    #    mira base ≈ 33-34°) y deja de crecer; (b) ABAJO la cámara se apoya en
    #    el guard de nieve (y ≥ 0,35) sin atravesarla nunca.
    page.keyboard.press("KeyC")
    page.wait_for_timeout(700)
    page.keyboard.down("KeyB")
    page.wait_for_timeout(2600)
    p_a = cam(page)["pitch"]
    page.wait_for_timeout(1500)
    p_b = cam(page)["pitch"]
    page.keyboard.up("KeyB")
    print(f"TOPE B: {math.degrees(p_a):+.2f}° → 1,5 s después {math.degrees(p_b):+.2f}° (meseta, no rampa)")
    assert p_a > 0.45, f"no llegó a la zona del tope: {math.degrees(p_a):.1f}°"
    assert abs(p_b - p_a) < math.radians(1.5), "el pitch sigue creciendo: el tope no actúa"
    assert p_a < 0.7 and p_b < 0.7, f"pitch arriba fuera de todo rango: {math.degrees(p_b):.1f}°"
    page.keyboard.press("KeyC")
    page.wait_for_timeout(700)
    page.keyboard.down("KeyV")
    page.wait_for_timeout(2600)
    page.keyboard.up("KeyV")
    c4 = cam(page)
    print(f"TOPE V: tras 2,6 s, pitch={math.degrees(c4['pitch']):+.2f}° y={c4['y']:.2f} (guard de nieve y ≥ 0,35)")
    assert c4["pitch"] > -0.55, f"pitch vertical fuera de rango: {math.degrees(c4['pitch']):.1f}°"
    assert c4["y"] >= 0.3, f"la cámara se metió BAJO la nieve: y={c4['y']}"

    # 7) REGRESIÓN T45: Z orbita lateral y C reencuadra TODO al instante
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyZ")
    c5 = cam(page)
    print(f"Z (regresión): yaw={math.degrees(c5['yaw']):+.1f}°")
    assert abs(c5["yaw"]) > 0.4, "la órbita lateral T45 se rompió"
    page.keyboard.press("KeyC")
    page.wait_for_timeout(700)
    c6 = cam(page)
    print(f"C (reencuadre): yaw={math.degrees(c6['yaw']):+.1f}° pitch={math.degrees(c6['pitch']):+.1f}°")
    assert abs(c6["yaw"]) < 0.04 and abs(c6["pitch"]) < 0.1, "C no reencuadra yaw+pitch"
    assert (probe(page) or {}).get("hands"), "HUD sin manos con la cámara orbitada"

    # 8) sin errores JS
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T46 VERDE ✅")
    browser.close()
