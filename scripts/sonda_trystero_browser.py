"""Sonda Trystero en Chromium real: dos pestañas señalizan por Nostr y se
intercambian un mensaje. Sirve scripts/ por HTTP y abre 2 páginas."""
import http.server, threading, functools, time
from playwright.sync_api import sync_playwright

HANDLER = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project/scripts")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8123), HANDLER)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    results = {}
    pages = []
    for role in ("a", "b"):
        pg = b.new_page()
        pg.goto("http://127.0.0.1:8123/sonda-trystero.html?role=" + role, wait_until="domcontentloaded")
        pages.append(pg)
    t0 = time.time()
    while time.time() - t0 < 35:
        vals = [pg.evaluate("window.__RESULT || null") for pg in pages]
        if all(vals):
            results = dict(zip(("a", "b"), vals))
            break
        time.sleep(1)
    for role, pg in zip(("a", "b"), pages):
        print(role, "=>", pg.evaluate("window.__RESULT || null"), "|", pg.evaluate("(window.__LOG||[]).slice(0,6).join(' | ')"))
    b.close()
srv.shutdown()
