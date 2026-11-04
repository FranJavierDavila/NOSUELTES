#!/usr/bin/env python3
"""T111c — diagnóstico del humo: nº de partículas vivas y A/B con el sistema apagado."""
import subprocess
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T111-capturas")
BASE = "http://127.0.0.1:3109/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3109"],
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
        info = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const pss=sc.scene.particleSystems;
            const ps=pss.find(p=>p.name==='chimenea');
            return { n: pss.length, names: pss.map(p=>p.name),
                     alive: ps ? ps.getActiveCount() : -1,
                     cap: ps ? ps.capacity : -1,
                     parts: ps ? (ps._particles ? ps._particles.length : -2) : -3,
                     started: ps ? ps.isStarted() : null,
                     rate: ps ? ps.emitRate : null, us: ps ? ps.updateSpeed : null,
                     emitBox: ps ? [ps.minEmitBox.x, ps.maxEmitBox.y] : null }; })()""")
        print("partículas:", info, flush=True)
        page.evaluate("__SHERPAS_DEBUG.camPin(4.43, 5.6, -1.87, 6.0)")
        page.wait_for_timeout(12000)
        page.screenshot(path=str(OUT / "t111-diag-humo-ON.png"), timeout=120000)
        # apagar el humo y repetir el MISMO encuadre
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const ps=sc.scene.particleSystems.find(p=>p.name==='chimenea'); if (ps) ps.dispose(); })()""")
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / "t111-diag-humo-OFF.png"), timeout=120000)
        print("A/B listo")
        browser.close()
finally:
    srv.kill()
