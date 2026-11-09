#!/usr/bin/env python3
"""Verificación rápida del servidor REAL del jugador (dev :3000 vía Caddy):
boot del nivel, buildtag vT98, sin errores JS, cero billetes al arrancar."""
import time, sys

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto("http://127.0.0.1:3000/?nivel=pared", wait_until="domcontentloaded")
        s = None
        t0 = time.time()
        while time.time() - t0 < 180:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(500)
        ok_boot = s and s.get("bloques", 0) > 0
        tag = page.evaluate("document.querySelector('[data-e=buildTag]')?.textContent || ''")
        bil = page.evaluate("window.__PARED.sonda().billetes")
        print(f"boot={'OK' if ok_boot else 'FALLO'} bloques={s['bloques'] if s else '?'} buildtag={tag!r} billetes_al_arrancar={bil} erroresJS={len(errores)}")
        if errores: print("primer error:", errores[0][:200])
        page.screenshot(path="/home/z/my-project/download/t98-dev-vivo.png")
        browser.close()
        sys.exit(0 if (ok_boot and tag == "vT98" and bil == 0 and not errores) else 1)
except Exception as e:
    import traceback; traceback.print_exc(); sys.exit(1)
