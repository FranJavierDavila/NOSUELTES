#!/usr/bin/env python3
"""Captura T57 en REPOSO (campamento base, sin fuerza): modelo sherpa.glb visible."""
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


def crop_around(page, shot_path, out_path, world_pos, box=(360, 480), scale=3.0):
    pr = probe(page, "project", world_pos[0], world_pos[1], world_pos[2])
    if not pr:
        print(f"  (sin proyección para {out_path})")
        return
    img = Image.open(shot_path)
    cx, cy = int(pr["x"]), int(pr["y"])
    w, h = box
    if not (-w < cx < img.width + w and -h < cy < img.height + h):
        print(f"  (fuera de encuadre: {cx},{cy} — salto {out_path})")
        return
    left, top = max(0, cx - w // 2), max(0, cy - h // 2)
    right, bottom = min(img.width, left + w), min(img.height, top + h)
    if right - left < 8 or bottom - top < 8:
        print(f"  (recorte degenerado — salto)")
        return
    crop = img.crop((left, top, right, bottom))
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    crop.save(out_path)
    print(f"  recorte {out_path}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)

    # arranque con reintentos
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=60000)
            page.click("button[data-a=go]")
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)

    # esperar escena + modelo + asentarse
    for _ in range(40):
        cl = probe(page, "climber")
        tex = page.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex") \
            if __import__("builtins").any([True]) else False
        try:
            tex = bool(page.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex"))
        except Exception:
            tex = False
        if tex and cl and cl.get("state") == "ready" and cl.get("players") == [True, True]:
            break
        page.wait_for_timeout(1000)
    print("modelo listo; asentando 12 s en reposo (sin fuerza)...")
    page.wait_for_timeout(12000)

    parts = probe(page, "particles", 0) or []
    if len(parts) == 15:
        pel = parts[4]
        print("pelvis p0:", [round(v, 2) for v in pel])
        page.screenshot(path=f"{OUT}/t57-4-reposo-general.png")
        crop_around(page, f"{OUT}/t57-4-reposo-general.png", f"{OUT}/t57-5-reposo-p0.png",
                    (pel[0], pel[1] + 0.3, pel[2]), box=(300, 440), scale=3.2)
        pp = probe(page, "puppetPieces") or {}
        p0 = (pp.get("p0") or {}).get("pieces", {})
        print("piezas p0:", {k: [round(c, 2) for c in v] for k, v in list(p0.items())[:4]})
    else:
        print("sin partículas — no capture")
    print("errores JS:", errors[:3])
    browser.close()
