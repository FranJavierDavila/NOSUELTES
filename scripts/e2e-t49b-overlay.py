#!/usr/bin/env python3
"""T49b — superposición partículas↔mesh: proyecta las 15 partículas de física
sobre la captura frontal y dibuja el esqueleto esperado. Si la piel (malla
oscura) CUBRE el esqueleto dibujado, el skinning es correcto."""
import time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

# pares del esqueleto de partículas (índices P de ragdoll.ts)
import sys
sys.path.insert(0, "/home/z/my-project")

def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    for _ in range(8):
        try:
            return page.evaluate(f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})")
        except Exception:
            page.wait_for_timeout(400)
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(2500)
    t0 = time.time()
    while time.time() - t0 < 40:
        c = probe(page, "climber")
        if c and c.get("state") == "ready" and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(250)
    page.wait_for_timeout(1200)

    parts = probe(page, "particles", 0)
    assert parts, "sin partículas"
    shot = f"{OUT}/t49b-3-overlay-full.png"
    page.screenshot(path=shot)

    img = Image.open(shot).convert("RGB")
    dr = ImageDraw.Draw(img)
    pts = []
    for p in parts:
        pr = probe(page, "project", p[0], p[1], p[2])
        pts.append(pr if pr else None)
    print(f"partículas: {len(parts)}")
    # esqueleto exacto según P (ragdoll.ts): head0 chest1 shL2 shR3 pelvis4
    # hipL5 hipR6 elbowL7 elbowR8 handL9 handR10 kneeL11 kneeR12 footL13 footR14
    BONES = [(0,1),(1,4),(1,2),(1,3),(2,7),(7,9),(3,8),(8,10),(4,5),(4,6),(5,11),(11,13),(6,12),(12,14)]
    for i, (p, s) in enumerate(zip(parts, pts)):
        if s:
            dr.ellipse([s["x"] - 5, s["y"] - 5, s["x"] + 5, s["y"] + 5], outline=(255, 40, 40), width=3)
            dr.text((s["x"] + 7, s["y"] - 7), str(i), fill=(255, 220, 0))
    for a, b in BONES:
        sa, sb = pts[a], pts[b]
        if sa and sb:
            dr.line([sa["x"], sa["y"], sb["x"], sb["y"]], fill=(255, 40, 40), width=2)
    img.save(f"{OUT}/t49b-3-overlay.png")
    print("overlay guardado")
    # recorte ampliado del P0
    w0 = None
    for _ in range(8):
        w0 = probe(page, "waist", 0)
        if w0: break
        page.wait_for_timeout(300)
    pr = probe(page, "project", w0["x"], w0["y"] + 0.9, w0["z"])
    cx, cy = int(pr["x"]), int(pr["y"])
    crop = img.crop((max(0, cx-170), max(0, cy-230), cx+170, cy+230))
    crop = crop.resize((crop.width*3, crop.height*3), Image.LANCZOS)
    crop.save(f"{OUT}/t49b-3-overlay-p0.png")
    print(f"recorte centro {cx},{cy}")
    browser.close()
