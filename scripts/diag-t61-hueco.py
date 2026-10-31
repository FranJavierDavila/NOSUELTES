#!/usr/bin/env python3
"""Diagnóstico T61 — huecos laterales de la pared: capturas orbitando a varias
alturas y cabeceos para reproducir la rendija de la captura del jugador."""
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=120000)
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    page.click("button[data-a=go]")
    # saltar onboarding si aparece (el último clic arranca la partida);
    # force=True: el hit-testing real cuelga con SwiftShader (main thread saturado)
    try:
        page.wait_for_selector("[data-a=obNext]", timeout=5000)
        for _ in range(6):
            try:
                page.click("[data-a=obNext]", timeout=9000, force=True)
                page.wait_for_timeout(400)
            except Exception:
                break
    except Exception:
        pass
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            ok = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            ok = False
        if ok:
            break
        # reintento de arranque si seguimos en el menú
        try:
            if page.locator("button[data-a=go]").is_visible():
                page.click("button[data-a=go]", timeout=3000)
        except Exception:
            pass
        page.wait_for_timeout(2000)
    print("partida arrancada:", time.time() - t0 < 145)
    page.wait_for_timeout(12000)  # warm-up shaders

    def orb(yaw, pitch, tag):
        page.evaluate(
            f"(function(){{var s=__SHERPAS_DEBUG.sceneObj(); s.orbitIdle=-99; s.orbitYawGoal={yaw}; s.orbitYaw={yaw}; s.orbitPitchGoal={pitch}; s.orbitPitch={pitch};}})()")
        page.wait_for_timeout(1300)
        page.screenshot(path=f"{OUT}/t61-diag-{tag}.png")
        print("captura", tag)

    # nivel bajo: laterales y cabeceo
    orb(1.13, 0.0, "bajo-der65")
    orb(1.48, 0.0, "bajo-der85")
    orb(-1.13, 0.0, "bajo-izq65")
    orb(-1.48, 0.0, "bajo-izq85")
    # subir y repetir
    for _ in range(3):
        page.evaluate("__SHERPAS_DEBUG.force('subir2')")
        page.wait_for_timeout(2500)
    page.evaluate("(function(){var s=__SHERPAS_DEBUG.sceneObj(); s.orbitYawGoal=0; s.orbitYaw=0; s.orbitPitchGoal=0; s.orbitPitch=0;})()")
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/t61-diag-alto-frente.png")
    orb(1.13, 0.0, "alto-der65")
    orb(1.48, 0.0, "alto-der85")
    orb(-1.13, 0.0, "alto-izq65")
    orb(-1.48, 0.0, "alto-izq85")
    orb(0.0, 0.5, "alto-cabiz")
    # vista libre más agresiva (si existe) a yaw máximo
    orb(2.0, 0.25, "alto-der115")
    orb(-2.0, 0.25, "alto-izq115")
    print("pageerrors:", len(errors), errors[:3])
    browser.close()
