#!/usr/bin/env python3
"""Smoke del ZIP jugable vT101: sirve el contenido descomprimido (raíz, sin
subruta), arranca el nivel, comprueba buildtag, sacudida y billetes en cuadro.
Uso: smoke-zip-vT101.py <dir-descomprimido> <puerto>"""
import subprocess, time, sys, urllib.request, signal

DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/zip-smoke"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8126
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", DIR],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(40):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = browser.new_context(viewport={"width": 1280, "height": 720}).new_page()
        cons = []
        pg.on("pageerror", lambda e: cons.append("PAGEERROR: " + str(e)[:150]))
        pg.on("requestfailed", lambda r: cons.append(f"FAIL {r.failure}: {r.url[:130]}"))
        pg.on("response", lambda r: cons.append(f"HTTP{r.status}: {r.url[-80:]}")
              if r.status >= 400 and ("_next" in r.url or "models" in r.url) else None)
        pg.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time(); ok = False
        while time.time() - t0 < 150:
            s = pg.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0:
                ok = True; break
            pg.wait_for_timeout(500)
        if not ok:
            print("NO ARRANCO; diagnostico:")
            for c in cons[:15]: print("  ", c)
            sys.exit(1)
        tag = pg.evaluate("document.querySelector('[data-e=buildTag]').textContent")
        pg.evaluate("window.__PARED.sacudir()")
        pg.evaluate("""async () => { const P = window.__PARED; const t0 = P.sonda().simT;
            while (P.sonda().simT - t0 < 1.5) await new Promise(r => setTimeout(r, 50)); }""")
        r = pg.evaluate("""() => {
            const P = window.__PARED;
            const s = P.sonda();
            const det = (P.billetes||[]).filter(b=>b.vivo).map(b => {
                let px = null; try { px = P.d.scene.projectToScreenCss(b.pos); } catch(e) {}
                return px ? [+px.x.toFixed(0), +px.y.toFixed(0)] : null;
            }).filter(Boolean);
            return { vivos: s.billetes, bajoSaco: s.billetesBajoSaco, posPct: det };
        }""")
        print("buildtag:", tag)
        print("tras sacudida 1.5 s de sim:", r)
        pg.screenshot(path=f"{DL}/zip-vT101-jugando.png")
        print("errores JS:", cons[:4] if cons else "ninguno")
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)
