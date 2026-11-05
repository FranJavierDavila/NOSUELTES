#!/usr/bin/env python3
"""T112-diag2 — aísla el ala: material VERDE PLANO (sin textura ni bump).
Si los pliegues persisten en verde → geometría/luz; si no → textura."""
import subprocess
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T112-capturas")
BASE = "http://127.0.0.1:3122/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3122"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--js-flags=--max-old-space-size=300",
        ])
        page = browser.new_context(viewport={"width": 480, "height": 320}).new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(12):
            try:
                page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            page.wait_for_timeout(700)
        for _ in range(25):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(1000)
        info = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const w=sc.scene.getMeshByName('sideWallL');
            const B = sc.scene.getEngine().getRenderingCanvas();
            // bounds mundo del ala
            w.computeWorldMatrix(true);
            const min=w.getBoundingInfo().boundingBox.minimumWorld, max=w.getBoundingInfo().boundingBox.maximumWorld;
            return { min:[min.x,min.y,min.z].map(v=>+v.toFixed(1)), max:[max.x,max.y,max.z].map(v=>+v.toFixed(1)) }; })()""")
        print("bounds ala L:", info, flush=True)
        page.evaluate("__SHERPAS_DEBUG.camPin(-7.3, 4.2, -1.3, 4.2)")
        page.wait_for_timeout(8000)
        # VERDE PLANO: sin albedoTexture, sin bump
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const m=sc.scene.getMaterialByName('massifRockM');
            m.albedoTexture = null; m.bumpTexture = null; })()""")
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const m=sc.scene.getMaterialByName('massifRockM');
            m.albedoColor.r = 0.1; m.albedoColor.g = 0.85; m.albedoColor.b = 0.15; })()""")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "t112-diag2-verde.png"), timeout=120000)
        browser.close()
finally:
    srv.kill()
