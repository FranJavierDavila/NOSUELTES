#!/usr/bin/env python3
"""E2E Task 45 — ÓRBITA LATERAL DE CÁMARA ±30° (petición del jugador).

"Se podría orbitar un poco la cámara hacia los lados, como unos 30 grados en
cada dirección para poder analizar los salientes."

Comprobaciones:
  1. DATOS: camera.json con orbitMaxDeg=30 (+ velocidad y suavizado) y teclas
     compartidas Z/X en input_maps; ayuda es/en mencionando la órbita.
  2. FRENTE: al nacer, yaw ≈ 0 (encuadre frontal clásico).
  3. Z (izquierda): manteniendo ~1,6 s la cámara orbita a ~+30° y se desplaza
     FÍSICAMENTE al lado izquierdo (pos.x baja > 1,5 m). Captura.
  4. PERSISTENCIA: al soltar, el ángulo SE MANTIENE (se analiza el saliente
     con calma) — no vuelve solo.
  5. C: reencuadre → yaw vuelve a ≈ 0.
  6. X (derecha): órbita a ~-30°, pos.x sube > 1,5 m. Captura.
  7. TOPE: manteniendo Z mucho más de lo necesario, el yaw queda clavado en
     +30° (±0,03 rad) — nunca se pasa de los 30 grados pedidos.
  8. JUGABLE EN ÓRBITA: con la cámara girada, el HUD sigue proyectando (sonda
     viva, manos agarradas) — arrastres y badges no se rompen.
Pipeline: menú → GO → spawn → frente → Z → persistencia → C → X → tope →
capturas → 0 errores JS.
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
         " return { yaw: c.rotation.y, x: c.position.x, y: c.position.y, z: c.position.z }; })()")
    return page.evaluate(q)

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return r.status, len(r.read())
    except Exception:
        return 0, 0

MAX_YAW = math.radians(30)

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) DATOS del pack: órbita ±30° + teclas Z/X + ayuda
    cdata = page.evaluate("fetch('/content/sherpas/camera.json').then(r => r.json())")
    imaps = page.evaluate("fetch('/content/sherpas/input_maps.json').then(r => r.json())")
    ses = page.evaluate("fetch('/content/sherpas/strings_es.json').then(r => r.json())")
    sen = page.evaluate("fetch('/content/sherpas/strings_en.json').then(r => r.json())")
    print(f"DATOS orbitMaxDeg={cdata['orbitMaxDeg']} speed={cdata['orbitSpeedDeg']}°/s smoothing={cdata['orbitSmoothing']}")
    assert cdata["orbitMaxDeg"] == 30, f"tope de órbita mal: {cdata['orbitMaxDeg']}"
    assert cdata["orbitSpeedDeg"] > 0 and cdata["orbitSmoothing"] > 0, "velocidad/suavizado de órbita ausentes"
    shared = imaps["shared"]
    assert shared.get("cameraOrbitLeft") == "KeyZ" and shared.get("cameraOrbitRight") == "KeyX", f"teclas Z/X mal: {shared}"
    st, sz = get(f"{URL}/content/sherpas/camera.json")
    assert st == 200 and sz > 250, f"camera.json no servido: {st} {sz}B"
    assert "Z/X" in ses["keys"]["shared"] and "Z/X" in sen["keys"]["shared"], "ayuda sin la órbita"
    assert "30°" in ses["help"]["extra"], "ayuda es sin los 30°"
    print(f"TECLAS: {shared['cameraOrbitLeft']}/{shared['cameraOrbitRight']} · ayuda es/en con órbita ±30°")

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")

    # 2) SPAWN: manos agarradas y roca lista
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 40, "chunks de roca")
    page.wait_for_timeout(700)

    # 3) FRENTE: yaw ≈ 0
    c0 = cam(page)
    assert c0, "sonda de cámara ausente (sceneObj)"
    print(f"FRENTE: yaw={math.degrees(c0['yaw']):+.1f}° pos=({c0['x']:.2f}, {c0['y']:.2f}, {c0['z']:.2f})")
    assert abs(c0["yaw"]) < 0.04, f"el arranque no es frontal: {c0['yaw']}"
    x0 = c0["x"]
    page.screenshot(path=f"{OUT}/t45-0-frente.png")
    print("CAPTURA t45-0-frente.png")

    # 4) Z → ÓRBITA IZQUIERDA: ~+30° y desplazamiento FÍSICO a la izquierda
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyZ")
    c1 = cam(page)
    print(f"Z (izquierda): yaw={math.degrees(c1['yaw']):+.1f}° pos.x={c1['x']:.2f} (Δx={c1['x']-x0:+.2f} m)")
    assert c1["yaw"] > 0.42, f"Z no orbita a la izquierda: {math.degrees(c1['yaw']):.1f}°"
    assert abs(c1["yaw"] - MAX_YAW) < 0.06, f"Z no llega a ~30°: {math.degrees(c1['yaw']):.1f}°"
    assert c1["x"] < x0 - 1.5, f"la cámara no se movió FÍSICAMENTE a la izquierda: Δx={c1['x']-x0:.2f}"
    assert abs(c1["z"] - c0["z"]) > 0.8, "el offset orbitado no retrocede en z (no parece órbita)"
    page.screenshot(path=f"{OUT}/t45-1-orbita-izquierda.png")
    print("CAPTURA t45-1-orbita-izquierda.png")

    # 5) PERSISTENCIA: soltada la tecla, el ángulo SE MANTIENE (analizar salientes con calma)
    page.wait_for_timeout(700)
    c2 = cam(page)
    drift = math.degrees(abs(c2["yaw"] - c1["yaw"]))
    print(f"PERSISTE: tras 0,7 s sin tocar nada, deriva={drift:.2f}°")
    assert drift < 2.0, f"la órbita no persiste (deriva {drift:.1f}°)"
    assert (probe(page) or {}).get("hands"), "HUD sin manos con la cámara orbitada"

    # 6) C → REENCUADRE: yaw vuelve a ≈ 0
    page.keyboard.press("KeyC")
    page.wait_for_timeout(800)
    c3 = cam(page)
    print(f"C (reencuadre): yaw={math.degrees(c3['yaw']):+.1f}°")
    assert abs(c3["yaw"]) < 0.04, f"C no reencuadra la órbita: {c3['yaw']}"

    # 7) X → ÓRBITA DERECHA: ~-30° y desplazamiento físico a la derecha
    page.keyboard.down("KeyX")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyX")
    c4 = cam(page)
    print(f"X (derecha): yaw={math.degrees(c4['yaw']):+.1f}° pos.x={c4['x']:.2f} (Δx={c4['x']-x0:+.2f} m)")
    assert c4["yaw"] < -0.42, f"X no orbita a la derecha: {math.degrees(c4['yaw']):.1f}°"
    assert abs(c4["yaw"] + MAX_YAW) < 0.06, f"X no llega a ~-30°: {math.degrees(c4['yaw']):.1f}°"
    assert c4["x"] > x0 + 1.5, f"la cámara no se movió FÍSICAMENTE a la derecha: Δx={c4['x']-x0:.2f}"
    page.screenshot(path=f"{OUT}/t45-2-orbita-derecha.png")
    print("CAPTURA t45-2-orbita-derecha.png")

    # 8) TOPE: mantener Z mucho más de lo necesario → nunca pasa de +30°
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(2600)
    page.keyboard.up("KeyZ")
    c5 = cam(page)
    print(f"TOPE: tras 2,6 s manteniendo Z, yaw={math.degrees(c5['yaw']):+.2f}° (tope +30°)")
    assert c5["yaw"] <= MAX_YAW + 0.02, f"la órbita SE PASA de 30°: {math.degrees(c5['yaw']):.1f}°"
    assert c5["yaw"] >= MAX_YAW - 0.06, f"no alcanzó el tope: {math.degrees(c5['yaw']):.1f}°"

    # 9) sin errores JS
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T45 VERDE ✅")
    browser.close()
