#!/usr/bin/env python3
"""Verificación T76 en caliente: pin de ánimo → cara GLB activa + primer plano.

Confirma con la sonda __SHERPAS_DEBUG.richFaces() que al pinear un ánimo se
ACTIVA la envoltura de su cara (face != null, enabled == 1) y captura un
primer plano de la cabeza (t76-cara_closeup.png) y el bocadillo con texto
(t76-bocadillo2.png).
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def recuperar(page) -> dict:
    t0 = time.time()
    rich = None
    while time.time() - t0 < 160:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
                page.wait_for_timeout(4000)
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
        except Exception:
            rich = None
            page.wait_for_timeout(3000)
            continue
        if rich and rich.get("pelvis"):
            break
        for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
            try:
                page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
            except Exception:
                pass
        page.wait_for_timeout(3000)
    if not rich or not rich.get("pelvis"):
        raise SystemExit("el ricachón nunca apareció")
    t0 = time.time()
    while time.time() - t0 < 60:
        try:
            faces = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if faces and faces.get("loaded") == 5:
                break
        except Exception:
            pass
        page.wait_for_timeout(3000)
    return rich


def ev(page, js: str, intentos: int = 3):
    for i in range(intentos):
        try:
            return page.evaluate(js)
        except Exception:
            if i == intentos - 1:
                raise
            recuperar(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))
    page.on("console", lambda m: errs.append(f"console: {m.text[:250]}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    for _ in range(12):
        page.wait_for_timeout(5000)
        try:
            if page.evaluate("!!window.__SHERPAS_DEBUG"):
                break
        except Exception:
            pass
        try:
            page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
        except Exception:
            pass
    page.wait_for_timeout(3000)
    rich = recuperar(page)
    page.wait_for_timeout(4000)
    pelvis = rich["pelvis"]
    print("pelvis:", json.dumps(pelvis), flush=True)

    # 1. Pin de cada ánimo → sonda de cara activa
    for mood, cara in [("enfado", "enfadado"), ("sorpresa", "asustado"),
                       ("furia", "gritando"), ("soberbia", "orgulloso"),
                       ("desconfianza", "chuleria"), ("alegre", None)]:
        ev(page, f"__SHERPAS_DEBUG.richMood('{mood}')")
        page.wait_for_timeout(2500)
        f = ev(page, "__SHERPAS_DEBUG.richFaces()")
        activa = (f or {}).get("active")
        ok = activa == cara or (cara is None and not activa)
        print(f"mood={mood:14s} esperado={str(cara):10s} activo={activa} {'OK' if ok else 'FALLO'}", flush=True)

    # 2. Primer plano con ENFADADO pineado
    ev(page, "__SHERPAS_DEBUG.richMood('enfado')")
    page.wait_for_timeout(4000)
    px, py, pz = pelvis["x"], pelvis["y"], pelvis["z"]
    ev(page, f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
      s.camTarget.set ? s.camTarget.set({px}, {py + 1.0}, {pz}) : (s.camTarget = {{x:{px}, y:{py + 1.0}, z:{pz}}});
      s.orbitYaw = 0.0; s.orbitPitch = 0.1; s.camDist = 1.35; return true; }})()""")
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/t76-cara_closeup.png")
    print("captura closeup ok", flush=True)

    # 3. BOCADILLO con texto
    said = False
    for _ in range(10):
        try:
            said = ev(page, "__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
        except Exception:
            said = False
        if said:
            break
        page.wait_for_timeout(1500)
    print("richSay ->", said, flush=True)
    page.wait_for_timeout(900)
    page.screenshot(path=f"{OUT}/t76-bocadillo2.png")
    print("captura bocadillo ok", flush=True)

    print("pageerrors:", len(errs), errs[:3], flush=True)
    browser.close()
