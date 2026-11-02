#!/usr/bin/env python3
"""Captura rápida de la pared (spawn) para iterar el look de la roca."""
import sys, time, json
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
NAME = sys.argv[1] if len(sys.argv) > 1 else "rock-iter"

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    if not el: return None
    try: return json.loads(el.get_attribute("data-probe"))
    except Exception: return None

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page); last = p
        if p and cond(p): return p
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT {label}: {json.dumps(last)[:300]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("relief") and q["relief"]["chunks"] > 0, 20, "roca")
    page.wait_for_timeout(1200)  # drena la cola de chunks
    page.screenshot(path=f"{OUT}/{NAME}.png")
    p = probe(page)
    print(json.dumps(p.get("relief", {})) if p else "sin sonda")
    browser.close()
print(f"CAPTURA {NAME}.png")
