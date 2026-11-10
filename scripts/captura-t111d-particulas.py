#!/usr/bin/env python3
"""T111d — ¿el camino de partículas está muerto en TODO el entorno o solo en el humo?
Compara alive de nieve vs chimenea y prueba manualEmitCount en el humo."""
import subprocess
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T111-capturas")
BASE = "http://127.0.0.1:3110/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3110"],
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
        print("estado:", page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const pss=sc.scene.particleSystems;
            const out={};
            for (const ps of pss){ out[ps.name]={ alive: ps._particles? ps._particles.length : -1,
                rate: ps.emitRate, started: ps.isStarted(), dt: sc.scene._engine.getDeltaTime() }; }
            return out; })()"""), flush=True)
        # manualEmitCount: fuerz 60 partículas por ENCIMA del rate escalado
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const ps=sc.scene.particleSystems.find(p=>p.name==='chimenea'); ps.manualEmitCount(60); })()""")
        page.wait_for_timeout(2500)
        print("tras manualEmit:", page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const ps=sc.scene.particleSystems.find(p=>p.name==='chimenea');
            return ps._particles.length; })()"""), flush=True)
        browser.close()
finally:
    srv.kill()
