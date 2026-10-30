#!/usr/bin/env python3
"""Recaptura la preview tras CALIENTE (espera el warm-up de shaders en frío):
captura general + cierres de los dos procedurales + roca estratificada.
Solo captura visual — sin aserciones (la E2E T53 ya validó el estado)."""
import time

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"


def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None


def screenshot_until_scene(page, path, tries=12, wait_ms=2500):
    """Captura y verifica que el canvas 3D esté PRESENTADO (no negro):
    la luminancia media del centro debe superar la del fondo del HUD."""
    from PIL import Image as _Img
    for i in range(tries):
        page.screenshot(path=path)
        img = _Img.open(path).convert("L")
        w, h = img.size
        centro = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
        stat = sum(centro.getdata()) / (centro.width * centro.height)
        if stat > 32:
            print(f"  frame presentado (luma centro {stat:.0f}) tras {i + 1} intentos")
            return True
        page.wait_for_timeout(wait_ms)
    print(f"  AVISO: el centro sigue oscuro (luma {stat:.0f}) tras {tries} intentos")
    return False


def crop_around(page, shot_path, out_path, world_pos, box=(360, 480), scale=3.0):
    pr = probe(page, "project", world_pos[0], world_pos[1], world_pos[2])
    if not pr:
        print(f"  (sin proyección para {out_path})")
        return
    img = Image.open(shot_path)
    cx, cy = int(pr["x"]), int(pr["y"])
    w, h = box
    left, top = max(0, cx - w // 2), max(0, cy - h // 2)
    right, bottom = min(img.width, left + w), min(img.height, top + h)
    crop = img.crop((left, top, right, bottom))
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    crop.save(out_path)
    print(f"  recorte {out_path}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    for _ in range(3):
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=5000)
            break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")

    # WARM-UP: esperar a que la escena pinte con estabilidad (compilación de
    # shaders en frío ~4 fps). 18 s de margen, luego doble frame de cortesía.
    so = None
    t0 = time.time()
    while time.time() - t0 < 25:
        so = probe(page, "sceneObj")
        if so and so.get("rigVisuals") and so.get("strataTex"):
            break
        page.wait_for_timeout(500)
    assert so and so.get("rigVisuals"), "escena no disponible"
    page.wait_for_timeout(18000)
    print(f"warm-up listo en {time.time() - t0:.0f}s")

    screenshot_until_scene(page, f"{OUT}/t53-0-general.png")
    print("captura general (caliente)")
    w0 = probe(page, "waist", 0)
    w1 = probe(page, "waist", 1)
    crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-1-p0-procedural.png",
                (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-2-p1-procedural.png",
                (w1["x"], w1["y"] + 0.9, w1["z"]))
    holds = probe(page, "holds") or []
    if holds:
        h = max(holds, key=lambda q: q["y"])
        crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-3-roca-estratos.png",
                    (h["x"], h["y"] + 0.35, 0.10), box=(420, 560), scale=2.2)

    print(f"errores JS: {len(errors)}")
    for e in errors:
        print(" ", e)
    browser.close()
print("RECAPTURA LISTA")
