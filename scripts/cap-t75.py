#!/usr/bin/env python3
"""Capturas T75: muro (piedra visible) + ricachón (twist anatómico).

Tres vistas fijando los campos de la cámara orbital (el bucle los respeta):
1. frontal del muro a la altura del tablón (comparar con la del jugador),
2. primer plano frontal del ricachón sentado (punteras, palmas, cara),
3. PERFIL (la dirección de las piernas se lee sin ambigüedad).
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

def cam_eval(kind: str, pelvis: dict) -> str:
    px, py, pz = pelvis["x"], pelvis["y"], pelvis["z"]
    if kind == "rico_frontal":
        return f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
          s.camTarget.set ? s.camTarget.set({px}, {py + 0.25}, {pz}) : (s.camTarget = {{x:{px}, y:{py + 0.25}, z:{pz}}});
          s.orbitYaw = 0; s.orbitPitch = 0.12; s.camDist = 2.6; return true; }})()"""
    if kind == "rico_perfil":
        return f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
          s.camTarget.set ? s.camTarget.set({px}, {py + 0.2}, {pz}) : (s.camTarget = {{x:{px}, y:{py + 0.2}, z:{pz}}});
          s.orbitYaw = 1.35; s.orbitPitch = 0.1; s.camDist = 3.0; return true; }})()"""
    # muro frontal a la altura del tablón
    return f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
      s.camTarget.set ? s.camTarget.set({px}, {py + 1.2}, 0) : (s.camTarget = {{x:{px}, y:{py + 1.2}, z:0}});
      s.orbitYaw = 0; s.orbitPitch = 0.06; s.camDist = 6.5; return true; }})()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    for _ in range(12):
        page.wait_for_timeout(5000)
        if page.evaluate("!!window.__SHERPAS_DEBUG"):
            break
        page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    page.wait_for_timeout(3000)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(2000)
    # HMR: las ediciones pueden recargar la página a mitad de sesión — espera a
    # que el ricachón exista OTRA VEZ (y re-pulsa el tutorial si hizo falta)
    rich = None
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
        except Exception:
            rich = None
        if rich and rich.get("pelvis"):
            break
        try:
            page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
            page.evaluate("(() => { const b = document.querySelector('[data-a=obSkip]'); if (b && b.offsetParent) b.click(); })()")
            page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (b && b.offsetParent) b.click(); })()")
        except Exception:
            pass
        page.wait_for_timeout(3000)
    if not rich or not rich.get("pelvis"):
        raise SystemExit("el ricachón nunca apareció")
    page.wait_for_timeout(6000)
    pelvis = rich["pelvis"]
    print("pelvis:", json.dumps(pelvis))

    for kind in ["muro", "rico_frontal", "rico_perfil"]:
        page.evaluate(cam_eval(kind, pelvis))
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/t75-{kind}.png")
        print("captura", kind, "ok")

    print("pageerrors:", errs[:4])
    browser.close()

print("ok")
