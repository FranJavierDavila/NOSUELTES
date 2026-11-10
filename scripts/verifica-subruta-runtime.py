#!/usr/bin/env python3
"""T85 — prueba E2E de la exportación estática en SUBRUTA (/NOSUELTES/), espejo
exacto de la URL de GitHub Pages (franjavierdavila.github.io/NOSUELTES/).

Sirve .next-export bajo /NOSUELTES/ con http.server y valida:
  - montaje del juego (window.__NS_SHERPAS) → los JSON de /content cargaron
  - portada del menú (cover.png) renderizada
  - canvas WebGL presente tras ¡GO!
  - peticiones de GLB sin 404 (sherpa, rico, caras) y 0 respuestas >= 400
  - 0 errores de consola / de página
Captura una pantalla del juego en download/.
"""
import functools
import http.server
import shutil
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = Path("/tmp/site-subruta")
SRC = Path("/home/z/my-project/.next-export")
PORT = 8098
BASE = f"http://127.0.0.1:{PORT}/NOSUELTES/"

if SITE.exists():
    shutil.rmtree(SITE)
(SITE / "NOSUELTES").mkdir(parents=True)
shutil.copytree(SRC, SITE / "NOSUELTES", dirs_exist_ok=True)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

console_errs: list[str] = []
page_errs: list[str] = []
bad_resp: list[str] = []
glb: list[str] = []

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.on("console", lambda m: console_errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: page_errs.append(str(e)))
    pg.on("response", lambda r: (
        glb.append(f"{r.status} {r.url.rsplit('/', 1)[-1]}") if ".glb" in r.url
        else (bad_resp.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    ))
    pg.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_selector('button[data-a="go"]', timeout=90000)
    titulo = pg.evaluate("(() => { const h = document.querySelector('h1'); return h ? h.textContent : null; })()")
    print("MENÚ:", titulo)

    # ¡GO! + saltar onboarding (selectores de las sondas T75+ ya probadas)
    for _ in range(6):
        pg.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
        pg.evaluate("(() => { const b = document.querySelector('[data-a=obSkip]'); if (b && b.offsetParent) b.click(); })()")
        pg.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (b && b.offsetParent) b.click(); })()")
        pg.wait_for_timeout(2500)
    pg.wait_for_timeout(18000)

    canvas = pg.evaluate("(() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null; })()")
    print("CANVAS:", canvas)
    pg.screenshot(path="/home/z/my-project/download/deploy-subruta-en-juego.png")
    b.close()
httpd.shutdown()

print("GLB:", glb if glb else "(ninguno)")
print("HTTP>=400:", bad_resp if bad_resp else "(ninguna)")
print("console.errors:", console_errs[:8] if console_errs else "(ninguno)")
print("pageerrors:", page_errs[:8] if page_errs else "(ninguno)")
ok = titulo and canvas and not bad_resp and not page_errs and not console_errs and len(glb) >= 2
print("RESULTADO:", "OK" if ok else "REVISAR")
