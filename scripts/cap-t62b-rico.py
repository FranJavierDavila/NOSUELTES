#!/usr/bin/env python3
"""Captura rápida T62b: partida → frontal + recorte del ricachón (sombrero/gafas/panza)."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    for ronda in range(3):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=90000)
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
    page.click("button[data-a=go]")
    page.wait_for_timeout(1500)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(2000)
    page.wait_for_timeout(13000)
    # gesto GRACIOSO para la captura: que brinde (copita en mano)
    try:
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('voz')")
    except Exception:
        pass
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{OUT}/t62-6-rico-v2.png")
    print("pageerrors:", errs[:3])
    browser.close()

from PIL import Image
img = Image.open(f"{OUT}/t62-6-rico-v2.png")
img.crop((470, 380, 810, 620)).resize((680, 480)).save("/tmp/crop-rico-v2.png")
img.crop((520, 460, 780, 580)).resize((780, 360)).save("/tmp/crop-tablon-v2.png")
print("ok")
