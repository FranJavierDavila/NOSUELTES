#!/usr/bin/env python3
"""Diagnóstico: tras forzar dron, samplear rich.state/gesture 30 s."""
import json, time
from playwright.sync_api import sync_playwright

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    try:
        return json.loads(el.get_attribute("data-probe")) if el else None
    except Exception:
        return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:3000", wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    t0 = time.time()
    p = None
    while time.time() - t0 < 25:
        p = probe(page)
        if p and p.get("hands") and p["hands"][0]["grips"] >= 3:
            break
        page.wait_for_timeout(250)
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('drone')")
    print("dron forzado; muestreando 30 s:")
    for i in range(30):
        page.wait_for_timeout(1000)
        q = probe(page) or {}
        r = q.get("rich", {})
        h = q.get("hands", [{}])
        pl = q.get("plank") or {}
        print(f"{i:2}s state={r.get('state'):>10} gesture={str(r.get('gesture')):>12} grips={h[0].get('grips') if h else '?'} tilt={pl.get('tiltDeg')}")
    browser.close()
