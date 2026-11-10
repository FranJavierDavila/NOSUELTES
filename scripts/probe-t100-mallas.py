#!/usr/bin/env python3
"""Sonda T100: arranque del nivel (sirviendo out/ en el puerto dado), sacudida
del saco y verificación de que la malla de CADA billete vivo tiene su posición
ABSOLUTA igual a la posición FÍSICA (sin padre: jerarquía del GLB rota).
Uso: probe-t100-mallas.py  →  salida por stdout."""
import subprocess, time, sys, urllib.request, signal

PORT = 3112
BASE = f"http://127.0.0.1:{PORT}"

# la exportación usa rutas absolutas /NOSUELTES/_next/... → symlink espejo
# (el build destruye el symlink anterior al recrear out/)
subprocess.run(["ln", "-sfn", "/home/z/my-project/out", "/home/z/my-project/out/NOSUELTES"], check=True)

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory",
     "/home/z/my-project/out"],
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
        pg.on("pageerror", lambda e: cons.append(f"PAGEERROR: {str(e)[:180]}"))
        pg.on("console", lambda m: cons.append(f"console.{m.type}: {m.text[:180]}")
              if m.type in ("error", "warning") else None)
        pg.on("requestfailed", lambda r: cons.append(f"REQFAIL: {r.url[-90:]} {r.failure}")
              if "models/" in r.url or "chunks/" in r.url else None)
        pg.on("response", lambda r: cons.append(f"HTTP{r.status}: {r.url[-90:]}")
              if r.status >= 400 and ("models/" in r.url or "chunks/" in r.url) else None)
        pg.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time(); ok = False
        while time.time() - t0 < 180:
            s = pg.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0:
                ok = True; break
            pg.wait_for_timeout(500)
        if not ok:
            print("NO ARRANCO; consola:", *cons[-12:], sep="\n  ")
            sys.exit(1)
        pg.evaluate("window.__PARED.sacudir()")
        pg.evaluate("""async () => { const P = window.__PARED; const t0 = P.sonda().simT;
            while (P.sonda().simT - t0 < 1.0) await new Promise(r => setTimeout(r, 50)); }""")
        filas = pg.evaluate("""() => {
            const P = window.__PARED;
            const out = [];
            for (const [id, m] of P.billeteMallas) {
                const a = m.getAbsolutePosition();
                const b = (P.billetes || []).find(x => x.id === id);
                out.push({ id, vis: m.isVisible,
                    abs: {x:+a.x.toFixed(2), y:+a.y.toFixed(2), z:+a.z.toFixed(2)},
                    fis: b ? {x:+b.pos.x.toFixed(2), y:+b.pos.y.toFixed(2), z:+b.pos.z.toFixed(2)} : null,
                    sinPadre: !m.parent });
            }
            return out;
        }""")
        for m in filas: print(m)
        print("errores JS:", cons if cons else "ninguno")
        browser.close()
finally:
    srv.send_signal(signal.SIGTERM)
