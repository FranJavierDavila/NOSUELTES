#!/usr/bin/env python3
"""Capturas T120 — arreglos del nivel Prueba del Campamento (pared):
cámara delante de la cara (escaladores visibles), anclas de cara, cuerda,
minimapa del HUD. Sirve out/ en 3100 bajo /NOSUELTES y abre ?nivel=pared."""
import subprocess
import sys
import time
import os
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/tmp/render-pared"


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


srv = start_servers()
os.makedirs(OUT, exist_ok=True)
try:
    from playwright.sync_api import sync_playwright
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
        # esperar al nivel: el nivel expone __PARED (sonda)
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                if page.evaluate("!!(window.__PARED && document.querySelector('canvas'))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        else:
            print("NO APARECIÓ __PARED", flush=True)
        page.wait_for_timeout(4000)  # asentar: cámara, bloques moviéndose, HUD
        page.screenshot(path=f"{OUT}/t120-1-general.png")
        print("vista general capturada", flush=True)

        sonda = None
        for _ in range(8):
            try:
                sonda = page.evaluate("window.__PARED && window.__PARED.sonda && window.__PARED.sonda()")
                if sonda:
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        print(f"sonda={sonda}", flush=True)

        # minimapa: el chip del HUD debe tener contenido pintado (canvas con presas)
        mm = page.evaluate("""(() => {
            const root = document.querySelector('.sphud .minimap');
            if (!root) return { existe: false };
            const cv = root.querySelector('canvas');
            if (!cv) return { existe: true, canvas: false };
            const c = cv.getContext('2d');
            const d = c.getImageData(0, 0, cv.width, cv.height).data;
            let pintados = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) pintados++;
            return { existe: true, canvas: true, w: cv.width, h: cv.height, pintados, visible: root.offsetParent !== null };
        })()""")
        print(f"minimapa={mm}", flush=True)

        # panel dev (F3): se abre y el juego sigue
        page.keyboard.press("F3")
        page.wait_for_timeout(800)
        panel = page.evaluate("!!document.querySelector('#pared-panel')")
        page.keyboard.press("F3")
        page.screenshot(path=f"{OUT}/t120-2-panel.png")
        print(f"panel_abre={panel}", flush=True)

        # unos segundos más: bloques moviéndose (segunda captura para comparar)
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/t120-3-mas-tarde.png")
        print(f"errores JS: {errs[:3]}", flush=True)
        browser.close()
finally:
    srv.kill()
print("CAPTURAS T120 LISTAS")
