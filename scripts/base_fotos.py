#!/usr/bin/env python3
"""T93 — capturas del visor de Base.glb desde 4 azimuts + frente/sesgo.
Sirve el proyecto por HTTP y fotografía el visor con Playwright."""
import http.server
import os
import socketserver
import threading
import functools

from playwright.sync_api import sync_playwright

ROOT = "/home/z/my-project"
PORT = 8127
OUT = "/tmp/render"
os.makedirs(OUT, exist_ok=True)

class TS(socketserver.TCPServer):
    allow_reuse_address = True

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
httpd = TS(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

# (nombre, azimut, elevación, distancia, target_y)
VIEWS = [
    ("frente_-z", -1.5708, 1.15, 2.6, 0.1),
    ("espalda_+z", 1.5708, 1.15, 2.6, 0.1),
    ("derecha_+x", 0.0, 1.15, 2.6, 0.1),
    ("izquierda_-x", 3.1416, 1.15, 2.6, 0.1),
    ("tres_cuartos", -0.9, 1.05, 2.8, 0.1),
    ("planta", -1.5708, 0.25, 3.0, 0.0),
]

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--enable-unsafe-swiftshader",
                                       "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 460, "height": 400})
    page.on("console", lambda m: print("[console]", m.type, m.text[:180]))
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:180]))
    page.goto(f"http://127.0.0.1:{PORT}/visor_base.html", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)
    print("titulo:", page.title())
    page.wait_for_function("document.title.startsWith('LOADED')", timeout=30000)
    for name, az, el, dist, ty in VIEWS:
        page.evaluate(f"""(() => {{
            const cam = window.__CAM;
            cam.alpha = {az}; cam.beta = {el}; cam.radius = {dist};
            cam.target.set(0, {ty}, -0.25);
        }})()""")
        page.wait_for_timeout(350)
        page.screenshot(path=f"{OUT}/base_{name}.png")
        print("ok", name)
    browser.close()
httpd.shutdown()
print("DONE")
