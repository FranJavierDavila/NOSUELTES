#!/usr/bin/env python3
"""E2E T49b — AUDITORÍA VISUAL de los escaladores con el .glb reparado.

Toma acercamientos REALES de P0 y P1: vista frontal + vista en órbita
(tecla Z mantenida), recortando alrededor del proyectado de la cintura y
ampliando ×3. Sin tocar código de juego: solo sondas de solo lectura.
"""
import json, time
from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):  # la navegación de Next destruye contextos: reintento
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None

def wait_climber(page, timeout_s=40):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        c = probe(page, "climber")
        if c and c.get("state") == "ready" and c.get("players") == [True, True]:
            return c
        page.wait_for_timeout(250)
    raise SystemExit(f"modelo no listo: {probe(page, 'climber')}")

def waist_of(page, p):
    for _ in range(8):
        w = probe(page, "waist", p)
        if w:
            return w
        page.wait_for_timeout(400)
    raise SystemExit(f"sin cintura para P{p}")

def crop_around(page, shot_path, out_path, world_pos, box=(340, 460), scale=3.0):
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
    print(f"  recorte {out_path} (centro {cx},{cy})")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(2500)
    c = wait_climber(page)
    print(f"MODELO listo: mapped={c['mapped']} restError={c.get('restError', -1):.2e}")
    page.wait_for_timeout(1200)

    w0 = waist_of(page, 0)
    w1 = waist_of(page, 1)
    print(f"cinturas: P0={w0} P1={w1}")

    # --- vista frontal ---
    s0 = f"{OUT}/t49b-0-frontal-full.png"
    page.screenshot(path=s0)
    crop_around(page, s0, f"{OUT}/t49b-0-p0-cierre.png", (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, s0, f"{OUT}/t49b-0-p1-cierre.png", (w1["x"], w1["y"] + 0.9, w1["z"]))

    # --- vista en órbita (mantener Z ~1.4 s ≈ 110° pedido, se clampa a 30°) ---
    page.keyboard.down("z")
    page.wait_for_timeout(1400)
    page.keyboard.up("z")
    page.wait_for_timeout(600)
    s1 = f"{OUT}/t49b-1-orbita-full.png"
    page.screenshot(path=s1)
    w0 = waist_of(page, 0); w1 = waist_of(page, 1)
    crop_around(page, s1, f"{OUT}/t49b-1-p0-cierre.png", (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, s1, f"{OUT}/t49b-1-p1-cierre.png", (w1["x"], w1["y"] + 0.9, w1["z"]))

    # --- más movimiento: subir y recapturar frontal ---
    ok = probe(page, "force", "subir") or probe(page, "force", "subir2")
    print(f"force subir: {ok}")
    page.wait_for_timeout(2600)
    s2 = f"{OUT}/t49b-2-escalando-full.png"
    page.screenshot(path=s2)
    w0 = waist_of(page, 0); w1 = waist_of(page, 1)
    crop_around(page, s2, f"{OUT}/t49b-2-p0-cierre.png", (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, s2, f"{OUT}/t49b-2-p1-cierre.png", (w1["x"], w1["y"] + 0.9, w1["z"]))

    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS — auditoría T49b completa")
    browser.close()
