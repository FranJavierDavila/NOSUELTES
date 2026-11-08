#!/usr/bin/env python3
"""Sonda rápida T91: valores de yCimaEfectiva, bolsaCuelloM y posición del
nodo de la bolsa en reposo, más una captura recortada del amarre."""
import subprocess, time, urllib.request, sys

BASE = "http://127.0.0.1:3100/NOSUELTES"
srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1)
        break
    except Exception:
        time.sleep(0.5)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        for _ in range(240):
            s = page.evaluate("window.__PARED ? window.__PARED.sonda() : null")
            if s and s.get("bolsa") is True and s.get("bloques", 0) > 0:
                break
            page.wait_for_timeout(400)
        s = page.evaluate("window.__PARED.sonda()")
        print("yCimaEfectiva =", s.get("yCimaEfectiva"))
        print("bolsaCuelloM =", s.get("bolsaCuelloM"))
        print("bolsaGeo =", s.get("bolsaGeo"))
        node = page.evaluate("""(() => {
          const B = window.__PARED;
          const n = B && B['bolsaNodo'];
          return n ? {x: +n.position.x.toFixed(2), y: +n.position.y.toFixed(2), z: +n.position.z.toFixed(2)} : null;
        })()""")
        print("bolsaNodo (cuello al amarre) =", node)
        page.wait_for_timeout(2500)
        page.screenshot(path="/tmp/t91-sonda.png")
        browser.close()
finally:
    srv.kill()
