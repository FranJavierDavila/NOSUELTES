#!/usr/bin/env python3
"""Diagnóstico Task 36: timeline de la caída (rope state, tabla, alturas)."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

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
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    t0 = time.time()
    p = None
    while time.time() - t0 < 25:
        p = probe(page)
        if p and p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3:
            break
        page.wait_for_timeout(200)
    print("spawn ok")
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')")
    t0 = time.time()
    while time.time() - t0 < 12:
        p = probe(page)
        if p and (p["a"]["y"] + p["b"]["y"]) / 2 > 8:
            break
        page.wait_for_timeout(200)
    page.wait_for_timeout(1200)
    print(f"base: A={p['a']['y']} B={p['b']['y']}")
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 0)")
    t0 = time.time()
    while time.time() - t0 < 8:
        q = probe(page)
        if q:
            pk = q.get("plank") or {}
            print(f"t={time.time()-t0:4.1f}  A={q['a']['y']:7.2f} B={q['b']['y']:7.2f}  "
                  f"rope0={q['rope'][0]['s']:8s} drop={q['rope'][0]['drop']:5.2f}  rope1={q['rope'][1]['s']:8s}  "
                  f"plank tilt={pk.get('tiltDeg')} slide={pk.get('slide')} fell={pk.get('fell')}  "
                  f"grips={q['hands'][0]['grips']}+{q['hands'][1]['grips']}")
        page.wait_for_timeout(150)
    if errs:
        print("JS ERRORS:", errs[:3])
    browser.close()
