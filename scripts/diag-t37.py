#!/usr/bin/env python3
"""Diagnóstico T37: estado A/B tras cada force('subir') para cazar el Δy gigante."""
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

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    print(f"  TIMEOUT {label}: {json.dumps(last)[:300]}")
    return None

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
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN A y={p['a']['y']} B y={p['b']['y']} cp={p['checkpoints']}")
    for i in range(6):
        ok = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')")
        page.wait_for_timeout(2500)
        q = probe(page)
        print(f"[{i}] subir={ok}  A y={q['a']['y']:.2f} x={q['a']['x']:.2f}  B y={q['b']['y']:.2f} x={q['b']['x']:.2f}  Δy={abs(q['a']['y']-q['b']['y']):.2f}  "
              f"grips {q['hands'][0]['grips']}/{q['hands'][1]['grips']}  rope={[r['s'] for r in q['rope']]}  "
              f"plank={q['plank']}  cp={q['checkpoints']}  respawn={q.get('respawn')}")
        if errors:
            print("JS ERRORS:", errors[:2]); break
    browser.close()
