#!/usr/bin/env python3
"""DIAGNÓSTICO MÍNIMO DETERMINISTA — susto en la BASE (sin escalar).
Con el fix (pataleo = susto + desplazamiento), cada 'caida' limpia debe soltar
una voz real del banco aunque la tabla esté en el suelo: el pataleo del susto
ES el desplazamiento. 3 sustos con cooldown de 9 s entre ellos."""
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
        page.wait_for_timeout(120)
    raise SystemExit(f"TIMEOUT {label}: {json.dumps(last)[:400]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    page.wait_for_timeout(2000)

    ok_count = 0
    for n in range(3):
        q = probe(page) or {}
        v0 = (q.get("voice") or {}).get("count", 0)
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
        fired = None
        for _ in range(46):  # 7 s
            page.wait_for_timeout(150)
            q = probe(page) or {}
            v = q.get("voice") or {}
            if v.get("count", 0) > v0 and fired is None:
                fired = (v.get("last"), v.get("count"), v.get("ostentateLeft"))
        state = "SÍ" if fired else "NO"
        if fired:
            ok_count += 1
        print(f"SUSTO {n+1}: voz real {state} → {fired}", flush=True)
        page.wait_for_timeout(9000)  # cooldown 8 s + margen

    print(f"RESUMEN: {ok_count}/3 sustos soltaron voz real natural", flush=True)
    if errors:
        print("ERRORES JS:", errors[:3], flush=True)
    browser.close()
