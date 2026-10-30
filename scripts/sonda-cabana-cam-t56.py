#!/usr/bin/env python3
"""Sonda T56 v2: cámara forzada a la cabaña + getActiveMeshes + capturas."""
import json, time
from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    go = False
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
        except Exception:
            page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(2000); continue
        try:
            page.wait_for_selector("button[data-a=go]", timeout=120000); go = True; break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(2000)
    assert go, "sin menú"
    page.click("button[data-a=go]")
    t0 = time.time()
    while time.time() - t0 < 60:
        so = probe(page, "sceneObj")
        if so and so.get("rigVisuals") and so.get("strataTex"): break
        page.wait_for_timeout(500)
    page.wait_for_timeout(10000)

    info = page.evaluate("""() => {
      const sc = __SHERPAS_DEBUG.sceneObj();
      const s = sc.scene;
      const out = { active: [], cabinNames: [] };
      s.meshes.forEach(m => { if (m.name.startsWith('cabin')) out.cabinNames.push(m.name); });
      const am = s.getActiveMeshes();
      for (let i = 0; i < am.length; i++) out.active.push(am.data[i].name);
      return out;
    }""")
    print("cabin meshes:", info.get("cabinNames"))
    act = info.get("active") or []
    print("active meshes:", len(act))
    print("cabin en active:", [n for n in act if "cabin" in n.lower()])
    print("spurs/scree en active:", [n for n in act if n in ("spurs", "screeFloor")])
    print("errores JS:", errs[:3])

    # FORZAR cámara a la cabaña cada frame (el juego la re-fija por frame)
    page.evaluate("""() => {
      const sc = __SHERPAS_DEBUG.sceneObj();
      window.__t56 = setInterval(() => {
        sc.camTarget.set(2.15, 1.0, 1.8);
        sc.camDist = 6.5;
        sc.orbitYaw = 0; sc.orbitPitch = 0; sc.orbitYawGoal = 0; sc.orbitPitchGoal = 0;
      }, 8);
    }""")
    page.wait_for_timeout(3000)
    page.screenshot(path="/tmp/t56-cam-cabana.png")
    page.evaluate("clearInterval(window.__t56)")
    print("captura /tmp/t56-cam-cabana.png")
    browser.close()

img = Image.open("/tmp/t56-cam-cabana.png")
img.crop((300, 100, 1000, 700)).resize((1000, 857), Image.LANCZOS).save("/tmp/t56-cam-cabana-crop.png")
print("listo")
