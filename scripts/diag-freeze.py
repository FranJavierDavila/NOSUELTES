#!/usr/bin/env python3
"""SONDA DE FREEZE — ¿el renderer se congela tras un susto en la base?
N sesiones frescas: spawn → force('caida') → sondear vida del main thread 9 s.
Reporta por ronda: vivo/muerto y cuándo dejó de responder."""
import json, sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 3

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
        page.wait_for_timeout(120)
    return None

with sync_playwright() as pw:
    for n in range(1, N + 1):
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.set_default_timeout(10000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:120]))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        page.click("text=SHERPAS AL LÍMITE")
        page.wait_for_selector("button[data-a=go]", timeout=8000)
        page.click("button[data-a=go]")
        ok = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
        if not ok:
            print(f"ronda {n}: spawn falló", flush=True)
            browser.close(); continue
        page.wait_for_timeout(1200)
        t0 = time.time()
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
        alive_until = None
        dead = False
        for i in range(60):
            page.wait_for_timeout(150)
            try:
                page.evaluate("1")
            except Exception:
                dead = True
                alive_until = i * 0.15
                break
        status = f"CONGELADA a los {alive_until:.1f}s del susto" if dead else "VIVA los 9 s completos"
        print(f"ronda {n}: {status} · errores JS: {errors[:2] or 'ninguno'}", flush=True)
        browser.close()
