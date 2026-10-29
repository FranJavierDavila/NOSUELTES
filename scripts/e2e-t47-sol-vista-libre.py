#!/usr/bin/env python3
"""E2E Task 47 — SOL ORBITAL + VISTA LIBRE TEMPORAL (petición del jugador).

"la órbita también gire el sol/sombras para estudiar cómo cae la luz en los
salientes" + "una tecla de vista libre temporal (mantener para mirar, soltar
para volver al juego)".

Comprobaciones:
  1. DATOS: camera.json con orbitSunFactor 1.0 + freeView* (75°/50°, ×1.8,
     retorno 2.2/s); tecla G en shared; ayuda es con "VISTA LIBRE".
  2. BASELINE: cámara frontal y sol EXACTAMENTE el de siempre (yaw 0).
  3. SOL ORBITAL: orbitando con Z, el azimut del sol gira con la cámara
     (Δazimut ≈ Δyaw) — las sombras BARRen los salientes. Captura.
  4. C reencuadra → el sol vuelve EXACTO a la base (dirección y posición).
  5. VISTA LIBRE (mantener G): con Z la cámara sobrepasa el tope normal de
     30° hasta la MESETA de 75° (con velocidad ×1.8). Captura.
  6. SOLTAR G → "soltar para volver al juego": funde de vuelta al frontal
     (con la tasa rápida) y el sol regresa con ella.
  7. VISTA LIBRE vertical: G+B sobrepasa el tope T46 (~33°) hasta ~54°.
  8. REGRESIÓN T45: Z + C reencuadre intactos. 0 errores JS.
Pipeline: datos → menú → GO → spawn → Z+sol → C → G+Z meseta → soltar →
G+B → retorno → Z/C → capturas → 0 errores JS. (El juego real en dev :3000.)
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

def sun(page):
    return page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sun ? __SHERPAS_DEBUG.sun() : null")

def sun_az(s):
    return math.atan2(s["dx"], s["dz"])

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
    page.wait_for_timeout(1200)

    # 1) DATOS del pack: sol orbital + vista libre
    cdata = page.evaluate("fetch('/content/sherpas/camera.json').then(r => r.json())")
    imaps = page.evaluate("fetch('/content/sherpas/input_maps.json').then(r => r.json())")
    ses = page.evaluate("fetch('/content/sherpas/strings_es.json').then(r => r.json())")
    print(f"DATOS sunFactor={cdata['orbitSunFactor']} freeYaw={cdata['freeViewYawMaxDeg']}° freePitch={cdata['freeViewPitchMaxDeg']}° mul={cdata['freeViewSpeedMul']} returnRate={cdata['freeViewReturnRate']}/s")
    assert cdata["orbitSunFactor"] == 1.0, "el sol no gira 1:1 con la órbita"
    assert cdata["freeViewYawMaxDeg"] == 75 and cdata["freeViewPitchMaxDeg"] == 50, "límites de vista libre mal"
    assert cdata["freeViewSpeedMul"] > 1 and cdata["freeViewReturnRate"] > cdata["orbitReturnRate"], "velocidad/retorno de vista libre mal"
    assert imaps["shared"].get("cameraFreeView") == "KeyG", f"tecla de vista libre mal: {imaps['shared']}"
    st, sz = get(f"{URL}/content/sherpas/camera.json")
    assert st == 200 and sz > 330, f"camera.json no servido: {st} {sz}B"
    assert "G vista libre" in ses["keys"]["shared"] and "VISTA LIBRE" in ses["help"]["extra"], "ayuda es sin la vista libre"
    print("TECLA G (vista libre) + sol orbital 1:1 · ayuda es actualizada")

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=20000)
    page.click("button[data-a=go]")

    # 2) SPAWN
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 40, "spawn")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 60, "chunks de roca")
    page.wait_for_timeout(700)

    c0 = cam(page)
    s0 = sun(page)
    assert c0 and s0, "sondas de cámara/sol ausentes"
    az0 = sun_az(s0)
    print(f"FRENTE: yaw={math.degrees(c0['yaw']):+.1f}° pitch={math.degrees(c0['pitch']):+.1f}° · sol dx={s0['dx']:+.4f} dz={s0['dz']:+.4f} (az={math.degrees(az0):+.1f}°)")
    assert abs(c0["yaw"]) < 0.04 and abs(c0["pitch"]) < 0.1, "el arranque no es frontal"
    dy0, dx0, dz0 = s0["dy"], s0["dx"], s0["dz"]

    # 3) SOL ORBITAL: Z → el azimut del sol sigue al yaw de la cámara
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyZ")
    c1 = cam(page)
    s1 = sun(page)
    daz = sun_az(s1) - az0
    print(f"Z órbita: yaw={math.degrees(c1['yaw']):+.1f}° · Δazimut sol={math.degrees(daz):+.1f}° (debe ≈ Δyaw)")
    assert abs(c1["yaw"]) > 0.4, f"la órbita lateral no funciona: {math.degrees(c1['yaw']):.1f}°"
    assert abs(daz - c1["yaw"]) < 0.12, f"el sol NO gira con la órbita: Δaz={math.degrees(daz):.1f}° vs yaw={math.degrees(c1['yaw']):.1f}°"
    assert abs(s1["dy"] - dy0) < 1e-6, "la ELEVACIÓN del sol no debe cambiar al orbitar"
    page.screenshot(path=f"{OUT}/t47-1-sombras-barridas.png")
    print("CAPTURA t47-1-sombras-barridas.png")

    # 4) C reencuadra → el sol vuelve EXACTO a la base
    page.keyboard.press("KeyC")
    page.wait_for_timeout(700)
    c2 = cam(page)
    s2 = sun(page)
    print(f"C (reencuadre): yaw={math.degrees(c2['yaw']):+.2f}° · sol dx={s2['dx']:+.5f} (base {dx0:+.5f})")
    assert abs(c2["yaw"]) < 0.04 and abs(c2["pitch"]) < 0.1, "C no reencuadra"
    assert abs(s2["dx"] - dx0) < 1e-3 and abs(s2["dz"] - dz0) < 1e-3, "el sol NO restauró su dirección base tras C"
    assert abs(s2["px"] - s0["px"]) < 1e-3 and abs(s2["pz"] - s0["pz"]) < 1e-3, "el sol NO restauró su posición base tras C"

    # 5) VISTA LIBRE en yaw: mantener G + Z → meseta en 75° (tope normal 30°)
    page.keyboard.down("KeyG")
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(3200)
    page.keyboard.up("KeyZ")
    c3 = cam(page)
    print(f"VISTA LIBRE G+Z: yaw={math.degrees(c3['yaw']):+.1f}° (tope normal ±30°)")
    assert abs(c3["yaw"]) > 0.7, f"la vista libre no amplió el giro: {math.degrees(c3['yaw']):.1f}°"
    page.wait_for_timeout(1500)  # sigue MANTENIDA G: el ángulo persiste (auto-retorno suspendido)
    c3b = cam(page)
    print(f"  mantenida G sin tocar nada: yaw={math.degrees(c3b['yaw']):+.1f}° (persistencia, sin auto-retorno)")
    assert abs(abs(c3b["yaw"]) - abs(c3["yaw"])) < math.radians(2), "la vista libre no persiste con G mantenida"
    page.screenshot(path=f"{OUT}/t47-2-vista-libre-75.png")
    print("CAPTURA t47-2-vista-libre-75.png")

    # 6) SOLTAR G → volver al juego: funde al frontal y el sol regresa con ella
    page.keyboard.up("KeyG")
    t0 = time.time()
    returned = None
    while time.time() - t0 < 20:
        cq = cam(page)
        if abs(cq["yaw"]) < 0.05 and abs(cq["pitch"]) < 0.1:
            returned = cq
            break
        page.wait_for_timeout(250)
    assert returned, f"al soltar G no volvió al juego en 20 s: {cam(page)}"
    print(f"SOLTAR G: de vuelta al frontal en ~{time.time()-t0:.1f} s (fundo, no corte)")
    page.wait_for_timeout(900)  # asienta el último tramo del fundido exponencial
    sq = sun(page)
    assert abs(sun_az(sq) - az0) < 0.05, f"el sol no volvió con la cámara: Δaz={math.degrees(sun_az(sq)-az0):.2f}°"

    # 7) VISTA LIBRE vertical: G+B → sobrepasa el tope T46 (~33°) hasta ~54°
    page.keyboard.down("KeyG")
    page.keyboard.down("KeyB")
    page.wait_for_timeout(2800)
    page.keyboard.up("KeyB")
    page.keyboard.up("KeyG")
    c4 = cam(page)
    print(f"VISTA LIBRE G+B: pitch={math.degrees(c4['pitch']):+.1f}° (tope normal ≈ +33°)")
    assert c4["pitch"] > 0.7, f"la vista libre vertical no amplió el tope: {math.degrees(c4['pitch']):.1f}°"
    t0 = time.time()
    while time.time() - t0 < 20:
        cq = cam(page)
        if abs(cq["pitch"]) < 0.1 and abs(cq["yaw"]) < 0.05:
            break
        page.wait_for_timeout(250)
    else:
        raise SystemExit(f"retorno vertical al soltar G no llegó: {cam(page)}")
    print(f"  retorno vertical en ~{time.time()-t0:.1f} s")

    # 8) REGRESIÓN T45: Z + C intactos; HUD con la vista libre
    page.keyboard.down("KeyZ")
    page.wait_for_timeout(1200)
    page.keyboard.up("KeyZ")
    c5 = cam(page)
    assert abs(c5["yaw"]) > 0.4, "la órbita lateral T45 se rompió"
    page.keyboard.press("KeyC")
    page.wait_for_timeout(700)
    c6 = cam(page)
    assert abs(c6["yaw"]) < 0.04 and abs(c6["pitch"]) < 0.1, "C no reencuadra tras la vista libre"
    assert (probe(page) or {}).get("hands"), "HUD sin manos"
    sfin = sun(page)
    assert abs(sfin["dx"] - dx0) < 1e-3, "sol final ≠ base"

    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T47 VERDE ✅")
    browser.close()
