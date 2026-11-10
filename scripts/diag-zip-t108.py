#!/usr/bin/env python3
"""Diagnóstico del smoke vT108: captura TODO el console.log del navegador,
errores de worker y el estado de arranque tick a tick, para ver por qué el
smoke del zip se queda sin window.__PARED. Uso: diag-zip-t108.py <dir> <puerto>"""
import subprocess, time, sys, signal

DIR = sys.argv[1]
PORT = int(sys.argv[2])
BASE = f"http://127.0.0.1:{PORT}"

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", DIR],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(40):
    try:
        import urllib.request
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = browser.new_context(viewport={"width": 1280, "height": 720}).new_page()
        msgs = []
        pg.on("console", lambda m: msgs.append(f"[{m.type}] {m.text[:160]}"))
        pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)[:200]))
        pg.on("crash", lambda _: msgs.append("PAGE CRASH"))
        pg.on("requestfailed", lambda r: msgs.append(f"FAIL {r.failure}: {r.url[:140]}"))
        pg.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time()
        while time.time() - t0 < 60:
            st = pg.evaluate("""() => ({
                ready: document.readyState,
                pared: !!(window.__PARED && window.__PARED.sonda),
                bloques: window.__PARED && window.__PARED.sonda ? (window.__PARED.sonda().bloques ?? -1) : -2,
                tag: (document.querySelector('[data-e=buildTag]')||{}).textContent || null,
            })""")
            print(f"t={time.time()-t0:4.1f}s", st, flush=True)
            if st.get("bloques", -1) and st.get("bloques", -1) > 0:
                print("ARRANCA OK"); break
            pg.wait_for_timeout(3000)
        print("--- console (últimas 30):")
        for m in msgs[-30:]: print("  ", m, flush=True)
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)
