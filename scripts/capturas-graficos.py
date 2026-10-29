#!/usr/bin/env python3
"""CAPTURAS DE GRÁFICOS — spawn (tabla+cielo nuevo) y vista en altura (niebla
atmosférica sobre la pared) para revisar la mejora de calidad general."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    if not el:
        return None
    try:
        return json.loads(el.get_attribute("data-probe"))
    except Exception:
        return None

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        p = probe(page)
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT {label}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.set_default_timeout(12000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 40, "chunks")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{OUT}/gfx-1-spawn.png")
    print("CAPTURA gfx-1-spawn.png")
    for _ in range(3):
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
        page.wait_for_timeout(900)
    wait_for(page, lambda q: (q.get("relief") or {}).get("viewBand", -1) >= 2, 40, "subida")
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/gfx-2-altura.png")
    print("CAPTURA gfx-2-altura.png")
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    browser.close()
