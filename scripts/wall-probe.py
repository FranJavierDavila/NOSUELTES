#!/usr/bin/env python3
"""Sonda T74 del MURO: entra en partida, vuelca getWallInfo() (chunks, plugins,
binds del clima), la dirección del sol, TODA la consola (errores/avisos de
shader/worker) y una captura. Viewport pequeño por la memoria del sandbox."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 800, "height": 500})
    console = []
    page.on("console", lambda m: console.append((m.type, m.text[:220])))
    page.on("pageerror", lambda e: console.append(("PAGEERROR", str(e)[:220])))
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
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    page.wait_for_timeout(3000)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(400)
    t0 = time.time()
    while time.time() - t0 < 90:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(1500)
    page.wait_for_timeout(9000)  # los chunks llegan en cola; darles aire

    info = page.evaluate("(() => { const s = __SHERPAS_DEBUG.sceneObj(); return s ? { wall: s.getWallInfo ? s.getWallInfo() : 'sin sonda', rich: s.getRichPuppetInfo ? s.getRichPuppetInfo() : null } : null; })()")
    sol = page.evaluate("__SHERPAS_DEBUG.sun && __SHERPAS_DEBUG.sun()")
    print("WALL INFO:", info)
    print("SOL:", sol)
    errs = [m for m in console if m[0] in ("error", "warning", "PAGEERROR")]
    print(f"consola: {len(console)} mensajes, {len(errs)} errores/avisos")
    for t, txt in errs[:14]:
        print(f"  [{t}] {txt}")
    page.screenshot(path=f"{OUT}/t74-muro-probe.png")
    browser.close()
print("ok")
