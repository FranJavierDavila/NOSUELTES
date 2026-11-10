#!/usr/bin/env python3
"""Smoke EN VIVA (Pages): modo test (?test=escalada) + Base.glb desplegados.
Badge visible, GLB descargado, 0 errores JS, partida local y capturas."""
import sys, time

LIVE = "https://franjavierdavila.github.io/NOSUELTES"

def wait_el(page, sel, timeout_s=60):
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
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                 "--disable-dev-shm-usage", "--force-device-scale-factor=1"]
        br = pw.chromium.launch(args=flags)
        ctx = br.new_context(viewport={"width": 640, "height": 440})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        cons: list[str] = []
        page.on("console", lambda m: cons.append(m.text[:200]))

        print("== SITIO EN VIVA: modo test + Base.glb ==")
        page.goto(f"{LIVE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        wait_el(page, "button[data-a=net]", timeout_s=120)
        ok("menú cargado en Pages", True)
        ok("insignia MODO TEST visible", page.evaluate("!!document.getElementById('sherpas-test-badge')"))
        page.screenshot(path="download/live-menu-test.png", timeout=20000)

        js_click(page, "[data-a=go]", wait_ms=2500)
        page.wait_for_timeout(12000)  # SwiftShader + red: deja asentar la escena
        glb = page.evaluate("performance.getEntriesByType('resource').some(r => r.name.includes('base.glb'))")
        glb_ms = page.evaluate("(performance.getEntriesByType('resource').find(r => r.name.includes('base.glb'))||{}).duration")
        ok("base.glb descargado por la escena (en viva)", glb,
           f"({glb_ms:.0f} ms de red)" if glb_ms else "")
        ok("sin aviso [basecamp] en consola", not any("[basecamp]" in c for c in cons))
        ok("0 errores JS", not errs, f"({len(errs)})" if errs else "")
        page.screenshot(path="download/live-partida-test.png", timeout=20000)

        # control: sin ?test no hay insignia
        page2 = ctx.new_page()
        page2.goto(LIVE, wait_until="domcontentloaded", timeout=60000)
        wait_el(page2, "button[data-a=net]", timeout_s=120)
        ok("sin ?test: insignia ausente (juego normal intacto)",
           not page2.evaluate("!!document.getElementById('sherpas-test-badge')"))

        br.close()
finally:
    pass
print("LIVE VERDE" if not fails else f"LIVE FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
