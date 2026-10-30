#!/usr/bin/env python3
"""Diagnóstico A SACO: caída → ventana → ¿quién re-ancla?"""
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    for _ in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=60000)
            page.click("button[data-a=go]")
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    for _ in range(40):
        try:
            ok = bool(page.evaluate("!!window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0) !== null && !!__SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex"))
            cl = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.climber && __SHERPAS_DEBUG.climber()") or {}
            ok = ok and cl.get("state") == "ready" and cl.get("players") == [True, True]
        except Exception:
            ok = False
        if ok:
            break
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=4000)
            page.wait_for_selector("button[data-a=go]", timeout=6000)
            page.click("button[data-a=go]")
        except Exception:
            pass
        page.wait_for_timeout(4000)
    assert ok, "el juego nunca arrancó"
    page.wait_for_timeout(10000)

    def probe(fn, *a):
        expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({', '.join(map(repr, a))})"
        try:
            return page.evaluate(expr)
        except Exception as e:
            return f"ERR {e}"

    probe("force", "subir", 0)
    page.wait_for_timeout(2500)
    probe("force", "subir", 0)
    page.wait_for_timeout(2500)
    parts = probe("particles", 0) or []
    print("y0 =", parts[4][1] if len(parts) == 15 else "?")
    probe("force", "caida", 0)
    for i in range(36):  # 18 s
        rope = probe("rope", 0)
        rm = (probe("ropeMash") or {}).get("p0")
        parts = probe("particles", 0) or []
        y = parts[4][1] if len(parts) == 15 else -1
        print(f"t={i*0.5:4.1f}s y={y:6.2f} rope={rope} meter={'SÍ' if rm else 'no'}", flush=True)
        if isinstance(rope, dict) and rope.get("state") == "climbing":
            print("¡RE-ANCLADO! detalles arriba")
            break
        page.wait_for_timeout(500)
    browser.close()
