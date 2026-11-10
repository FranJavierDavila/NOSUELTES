"""Sonda rápida de la web en vivo: qué ve un usuario real al abrir el juego."""
import time
from playwright.sync_api import sync_playwright

URL = "https://franjavierdavila.github.io/NOSUELTES/"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 960, "height": 600})
    consola, pagerr, fallos = [], [], []
    pg.on("console", lambda m: consola.append(f"{m.type}: {m.text[:200]}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: pagerr.append(str(e)[:200]))
    pg.on("requestfailed", lambda r: fallos.append(f"{r.failure} {r.url[:120]}"))

    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(15000)  # carga del bundle + Babylon + menú
    titulo = pg.title()
    body_chars = len(pg.inner_text("body"))
    botones = pg.eval_on_selector_all("button, [role=button], canvas", "els => els.map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 40)).slice(0, 12)")
    webgl = pg.evaluate("!!document.createElement('canvas').getContext('webgl2') || !!document.createElement('canvas').getContext('webgl')")
    pg.screenshot(path="/home/z/my-project/download/live-probe-15s.png")
    print(f"título: {titulo!r}  ({time.time()-t0:.0f}s)")
    print(f"texto del body: {body_chars} chars")
    print(f"WebGL disponible: {webgl}")
    print(f"elementos: {botones}")
    print(f"errores consola: {len(consola)}"); [print("  ", c) for c in consola[:8]]
    print(f"errores de página: {len(pagerr)}"); [print("  ", e) for e in pagerr[:8]]
    print(f"peticiones fallidas: {len(fallos)}"); [print("  ", f) for f in fallos[:8]]
    b.close()
