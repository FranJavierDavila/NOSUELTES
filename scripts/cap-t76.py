#!/usr/bin/env python3
"""Capturas T76: hombros, de pie, caras expresivas y bocadillo con texto.

1. t76-sentado    — frontal cercano: hombros del modelo (brazos fuera del tronco).
2. t76-depie      — de pie forzado (richStand): los pies SOBRE el tablón.
3. t76-cara_enfadado — ánimo enfado pineado → pieza_cara_enfadado sustituye a la cabeza.
4. t76-bocadillo  — richSay: globo ANCHO con la cara y la frase al lado.
5. t76-cara_asustado — ánimo sorpresa → pieza_cara_asustado.
El dev server puede recargar la página a mitad de sesión (HMR/memoria):
ev() recupera la sesión (menú → tutorial → rico → caras) tras cada recarga.
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def cam(pelvis: dict, dy: float, dist: float, yaw: float = 0.0, pitch: float = 0.12) -> str:
    px, py, pz = pelvis["x"], pelvis["y"], pelvis["z"]
    return f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
      s.camTarget.set ? s.camTarget.set({px}, {py + dy}, {pz}) : (s.camTarget = {{x:{px}, y:{py + dy}, z:{pz}}});
      s.orbitYaw = {yaw}; s.orbitPitch = {pitch}; s.camDist = {dist}; return true; }})()"""


def recuperar(page) -> dict:
    """Recupera la sesión tras una recarga del dev (HMR): menú → tutorial →
    ricachón → caras. Devuelve la sonda del ricachón (pelvis)."""
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
        raise SystemExit("el ricachón nunca apareció (tras recarga)")
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
    """page.evaluate con recuperación de sesión si el dev recargó."""
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

    # 1. SENTADO frontal (hombros)
    ev(page, cam(pelvis, 0.25, 2.4))
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/t76-sentado.png")
    print("captura sentado ok", flush=True)

    # 2. DE PIE (pin E2E) — frontal amplio para leer pies vs tablón
    print("richStand(true) ->", ev(page, "__SHERPAS_DEBUG.richStand(true)"), flush=True)
    page.wait_for_timeout(3500)  # fundido sentado→de pie (~1 s) + margen
    ev(page, cam(pelvis, 0.35, 2.9))
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/t76-depie.png")
    print("captura depie ok", flush=True)
    ev(page, "__SHERPAS_DEBUG.richStand(false)")

    # 3. CARA ENFADADO (pin de ánimo → swap de cabeza)
    print("richMood(enfado) ->", ev(page, "__SHERPAS_DEBUG.richMood('enfado')"), flush=True)
    page.wait_for_timeout(6000)
    print("richFaces:", json.dumps(ev(page, "__SHERPAS_DEBUG.richFaces()")), flush=True)
    ev(page, cam(pelvis, 1.0, 1.7, 0.0, 0.1))
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/t76-cara_enfadado.png")
    print("captura cara_enfadado ok", flush=True)

    # 4. BOCADILLO CON TEXTO (habla forzada; reintenta hasta que la textura del
    #    ánimo llegue y la cara quede en crudo cacheada)
    said = False
    for _ in range(12):
        try:
            said = ev(page, "__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
        except Exception:
            said = False
        if said:
            break
        page.wait_for_timeout(1500)
    print("richSay ->", said, flush=True)
    print("richMood:", json.dumps(ev(page, "__SHERPAS_DEBUG.richMood()")), flush=True)
    ev(page, cam(pelvis, 0.9, 2.2, 0.0, 0.1))
    page.wait_for_timeout(1200)
    page.screenshot(path=f"{OUT}/t76-bocadillo.png")
    print("captura bocadillo ok", flush=True)

    # 5. CARA ASUSTADO
    print("richMood(sorpresa) ->", ev(page, "__SHERPAS_DEBUG.richMood('sorpresa')"), flush=True)
    page.wait_for_timeout(5000)
    print("richFaces:", json.dumps(ev(page, "__SHERPAS_DEBUG.richFaces()")), flush=True)
    ev(page, cam(pelvis, 1.0, 1.7, 0.0, 0.1))
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{OUT}/t76-cara_asustado.png")
    print("captura cara_asustado ok", flush=True)

    print("pageerrors:", errs[:4])
    browser.close()

print("ok")
