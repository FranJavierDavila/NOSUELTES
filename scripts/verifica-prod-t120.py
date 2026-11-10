#!/usr/bin/env python3
"""Verificación en PRODUCCIÓN (GitHub Pages) del T120: ?nivel=pared en vivo."""
import time, json
from playwright.sync_api import sync_playwright

BASE = "https://franjavierdavila.github.io/NOSUELTES"
OUT = "/tmp/render-pared"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
    t0 = time.time()
    ok = False
    while time.time() - t0 < 120:
        try:
            if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                ok = True
                break
        except Exception:
            pass
        page.wait_for_timeout(1000)
    print("nivel_cargado=", ok)
    if ok:
        page.wait_for_timeout(6000)  # banner + asentar
        sonda = page.evaluate("window.__PARED.sonda()")
        print("sonda=", json.dumps({k: sonda[k] for k in ('state', 'bloques', 'cuerda', 'paso')}))
        mm = page.evaluate("""(() => {
            const root = document.querySelector('.sphud .minimap');
            if (!root) return { existe: false };
            const cv = root.querySelector('canvas');
            if (!cv) return { existe: true, canvas: false };
            const c = cv.getContext('2d');
            const d = c.getImageData(0, 0, cv.width, cv.height).data;
            let p = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) p++;
            return { existe: true, canvas: true, pintados: p, visible: root.offsetParent !== null };
        })()""")
        print("minimapa=", mm)
        page.screenshot(path=f"{OUT}/prod-1-general.png")
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{OUT}/prod-2-cuerda.png")
    print("errores JS:", errs[:3])
    browser.close()
print("PROD OK")
