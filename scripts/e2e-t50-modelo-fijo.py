#!/usr/bin/env python3
"""E2E T50 — verificación VISUAL del modelo saneado (escalador-fixed.glb).
Cierres reales (recorte ×3 alrededor de la cintura proyectada) + verificación
de que la piel SIGUE a la física al escalar. 0 errores JS."""
import json, time
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
            page.click("text=SHERPAS AL LÍMITE", timeout=5000); break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    t0 = time.time()
    c = None
    while time.time() - t0 < 40:
        c = probe(page, "climber")
        if c and c.get("state") == "ready" and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    assert c, f"modelo no listo: {c}"
    assert c["mapped"] >= 20 and not c["missing"], f"huesos: {c}"
    assert c.get("restError", 1) < 0.05, f"restError: {c}"
    assert 0.5 < c.get("heightModel", 0) < 3.5, f"alto absurdo: {c}"
    print(f"MODELO: mapped={c['mapped']}/20 alto={c['heightModel']:.2f}m restError={c['restError']:.2e}")
    page.wait_for_timeout(1500)

    # vista general + cierres de ambos
    page.screenshot(path=f"{OUT}/t50-0-general.png")
    w0 = probe(page, "waist", 0)
    w1 = probe(page, "waist", 1)
    print(f"cinturas: P0={w0} P1={w1}")
    crop_around(page, f"{OUT}/t50-0-general.png", f"{OUT}/t50-1-p0-cierre.png", (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, f"{OUT}/t50-0-general.png", f"{OUT}/t50-1-p1-cierre.png", (w1["x"], w1["y"] + 0.9, w1["z"]))

    # LA FÍSICA MANDA: subir y comprobar que las partículas y la piel siguen
    before = probe(page, "particles", 0)
    ok = probe(page, "force", "subir")
    if not ok:
        ok = probe(page, "force", "subir2")
    page.wait_for_timeout(2500)
    after = probe(page, "particles", 0)
    moved = sum(1 for a, b in zip(before, after)
                if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 0.05)
    assert before and after and moved >= 3, f"sin movimiento: {moved}/15"
    print(f"POSE VIVA: {moved}/15 partículas se movieron >5cm")
    page.screenshot(path=f"{OUT}/t50-2-escalando.png")
    w0b = probe(page, "waist", 0)
    crop_around(page, f"{OUT}/t50-2-escalando.png", f"{OUT}/t50-3-escalando-cierre.png", (w0b["x"], w0b["y"] + 0.9, w0b["z"]))

    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS — E2E T50 VERDE ✅")
    browser.close()
