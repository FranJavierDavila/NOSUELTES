#!/usr/bin/env python3
"""DIAGNÓSTICO MÍNIMO DETERMINISTA — susto en la BASE (sin escalar), con pasos."""
import json, time, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
LOG = open("/home/z/my-project/scripts/diag-base.log", "w")

def out(msg):
    LOG.write(msg + "\n"); LOG.flush()
    print(msg, flush=True)

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
        page.wait_for_timeout(120)
    out(f"TIMEOUT {label}: {json.dumps(last)[:300] if last else None}")
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    out("paso 1: goto")
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    out("paso 2: menú")
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    out("paso 3: spawn")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    page.wait_for_timeout(2000)

    ok_count = 0
    for n in range(3):
        out(f"paso 4.{n}: susto")
        q = probe(page) or {}
        v0 = (q.get("voice") or {}).get("count", 0)
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
        fired = None
        for _ in range(40):  # 6 s
            page.wait_for_timeout(150)
            q = probe(page) or {}
            v = q.get("voice") or {}
            if v.get("count", 0) > v0 and fired is None:
                fired = (v.get("last"), v.get("count"), v.get("ostentateLeft"))
        if fired:
            ok_count += 1
        out(f"SUSTO {n+1}: voz {'SÍ ' + str(fired) if fired else 'NO'}")
        page.wait_for_timeout(9000)

    out(f"RESUMEN: {ok_count}/3")
    if errors:
        out("ERRORES JS: " + str(errors[:3]))
    browser.close()
LOG.close()
