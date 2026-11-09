#!/usr/bin/env python3
"""Smoke de la exportación estática T99: sirve out/ en local y comprueba que
el juego arranca (nivel pared), el buildtag es vT99 y no hay errores JS."""
import subprocess, time, sys, urllib.request

PORT = 3111
BASE = f"http://127.0.0.1:{PORT}"
fallos = []

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
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        s = None
        t0 = time.time()
        while time.time() - t0 < 120:
            s = page.evaluate("window.__PARED && window.__PARED.sonda() ? {ok:true, s:window.__PARED.sonda()} : null")
            if s and s.get("ok") and s["s"].get("bloques", 0) > 0:
                break
            page.wait_for_timeout(500)
        ok_boot = bool(s and s.get("ok") and s["s"].get("bloques", 0) > 0)
        print(("✓" if ok_boot else "✗") + " arranque del nivel pared en la exportación estática"
              + (f" — bloques={s['s']['bloques']} estado={s['s']['state']} bolsaY={s['s'].get('bolsaY')}" if ok_boot else f" (sonda={s})"), flush=True)
        if not ok_boot: fallos.append("arranque")

        tag = page.evaluate("document.querySelector('[data-e=buildTag]') ? document.querySelector('[data-e=buildTag]').textContent : ''")
        print(("✓" if tag == "vT99" else "✗") + f" buildtag visible: {tag!r}", flush=True)
        if tag != "vT99": fallos.append("buildtag")

        ley = page.evaluate("""() => { const s = window.__PARED.sonda();
            return { billetes: s.billetes, bajoSaco: s.billetesBajoSaco }; }""")
        print(("✓" if ley["billetes"] == 0 and ley["bajoSaco"] == 0 else "✗")
              + f" ley al arrancar: billetes={ley['billetes']} bajoSaco={ley['bajoSaco']}", flush=True)
        if ley["billetes"] != 0 or ley["bajoSaco"] != 0: fallos.append("ley-arranque")

        print(("✓" if not errores else "✗") + " sin errores JS" + (f" — {errores[:3]}" if errores else ""), flush=True)
        if errores: fallos.append("js")
        page.screenshot(path="/home/z/my-project/download/t99-export-smoke.png")
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc(); fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO EXPORT T99 ==", flush=True)
if fallos:
    print("FALLOS:", *fallos, sep="\n - "); sys.exit(1)
print("EXPORT OK — vT99 jugable y ley activa")
