#!/usr/bin/env python3
"""Capturas Task 30 con viento CONTINUO (tuning del standalone forzado):
   ráfagas (3 frames separados 400 ms para ver el desplazamiento de partículas),
   calma de referencia y plano de la tabla con las colas."""
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

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    # esperar partida viva
    t0 = time.time()
    while time.time() - t0 < 25:
        p = probe(page)
        if p and p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3:
            break
        page.wait_for_timeout(250)
    # esperar racha plena
    t0 = time.time()
    while time.time() - t0 < 40:
        p = probe(page)
        if p and p["weather"]["phase"] == "gust" and p["weather"]["level"] > 0.8:
            break
        page.wait_for_timeout(200)
    print(f"RACHA plena level={p['weather']['level']} dir={p['weather']['dir']} shake={(p['plank'] or {}).get('shakeDeg')}")
    for i in range(3):
        page.screenshot(path=f"{OUT}/t30-wind-{i}.png")
        page.wait_for_timeout(400)
    # la tabla de cerca (recorte)
    page.screenshot(path=f"{OUT}/t30-wind-tabla.png", clip={"x": 380, "y": 300, "width": 560, "height": 400})
    print("capturas de racha listas")
    browser.close()
