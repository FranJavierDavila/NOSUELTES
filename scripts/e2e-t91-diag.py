#!/usr/bin/env python3
"""Diagnóstico T91: sondeo cada 2 s de baseCamp/recursos/consola + capturas
con timeout holgado. El servidor debe estar ya en el 3100."""
import sys, time

BASE = "http://localhost:3100"

def wait_el(page, sel, timeout_s=40):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate(f"!!document.querySelector('{sel}')"):
                return
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise TimeoutError(f"no apareció {sel}")

def js_click(page, sel, wait_ms=400):
    page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (e) e.click(); }})()")
    page.wait_for_timeout(wait_ms)

fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}") or (None if c else fails.append(n))
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
             "--disable-dev-shm-usage", "--force-device-scale-factor=1"]
    br = pw.chromium.launch(args=flags)
    ctx = br.new_context(viewport={"width": 640, "height": 440})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    cons: list[str] = []
    page.on("console", lambda m: cons.append(m.text[:200]))
    reqs: list[str] = []
    page.on("response", lambda r: reqs.append(f"{r.status} {r.url[-60:]}") if "base.glb" in r.url else None)

    page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
    wait_el(page, "button[data-a=net]", timeout_s=90)
    js_click(page, "[data-a=go]", wait_ms=2500)

    # sondeo: ¿cuándo aparece el GLB en escena?
    pieces = 0
    for i in range(15):
        page.wait_for_timeout(2000)
        bc = page.evaluate("window.__SHERPAS_DEBUG?.baseCamp?.()") or {}
        pieces = bc.get("cabinPieces", 0)
        glbreq = reqs[-1] if reqs else "—"
        print(f"  t={2*(i+1)}s cabinPieces={pieces} base.glb={glbreq} errs={len(errs)}")
        if pieces >= 1:
            break
    ok("GLB cargado (cabinPieces ≥ 1)", pieces >= 1)
    for c in cons[-8:]:
        print("   cons:", c)
    for e in errs[:4]:
        print("   err:", e)

    # captura de spawn con timeout holgado
    try:
        page.screenshot(path="download/t91-spawn.png", timeout=45000)
        ok("captura de spawn", True)
    except Exception as e:
        ok("captura de spawn", False, f"({e.__class__.__name__})")
    br.close()
print("DIAG VERDE" if not fails else f"DIAG FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
