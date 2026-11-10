#!/usr/bin/env python3
"""T112-diag — A/B del material del ala: (1) tal cual, (2) StandardMaterial
rojo plano (solo geometría), (3) massifRockM sin plugins (loseta sola)."""
import subprocess
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T112-capturas")
BASE = "http://127.0.0.1:3121/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3121"],
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
        page.evaluate("__SHERPAS_DEBUG.camPin(-7.3, 4.2, -1.3, 4.2)")
        page.wait_for_timeout(9000)
        page.screenshot(path=str(OUT / "t112-diag-1-tal-cual.png"), timeout=120000)
        # plan B: clonar el material base del pedriz (PBR piedra) para ver la geometría
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const wing=sc.scene.getMeshByName('sideWallL');
            const ped=sc.scene.getMaterialByName('baseRockM');
            if (wing && ped) wing.material = ped; })()""")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "t112-diag-2-pedriza.png"), timeout=120000)
        # (3) massifRockM sin plugins: clonar y vaciar plugin lists no es trivial
        # en runtime; basta apagar los efectos: alpha de estratos vía material flags
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const wing=sc.scene.getMeshByName('sideWallL');
            const mat=sc.scene.getMaterialByName('massifRockM');
            if (wing && mat) wing.material = mat; })()""")
        page.wait_for_timeout(2500)
        info = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const mat=sc.scene.getMaterialByName('massifRockM');
            return { hasAlbedo: !!mat.albedoTexture, albedo: mat.albedoColor && [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b],
                     uvSrc: sc.scene.getMeshByName('sideWallL').getVerticesData('uv').slice(0, 6).map(v=>+v.toFixed(2)) }; })()""")
        print("material:", info, flush=True)
        browser.close()
finally:
    srv.kill()
