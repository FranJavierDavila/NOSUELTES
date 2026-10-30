#!/usr/bin/env python3
"""DIAGNÓSTICO FINO — rastrear POR QUÉ los sustos naturales no sueltan voz.
Muestrea la sonda voice() completa (count/since/busy/armed) alrededor de UN
susto 'caida' para distinguir: ¿no se llama fireRealVoice (since sigue alto) o
se llama pero shoutReal falla (since baja pero count no sube)?"""
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

    for i in range(3):
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
        page.wait_for_timeout(600)
    wait_for(page, lambda q: (q.get("relief") or {}).get("viewBand", -1) >= 1, 40, "subida")
    page.wait_for_timeout(2500)

    p = probe(page)
    print(f"PRE-SUSTO   voice={json.dumps(p.get('voice'))} plank={json.dumps(p.get('plank'))} rich={p.get('rich', {}).get('state')}")

    page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
    for i in range(24):  # 12 s a 500 ms
        page.wait_for_timeout(500)
        q = probe(page) or {}
        v = q.get("voice") or {}
        pk = q.get("plank") or {}
        print(f"t+{i*0.5:4.1f}s count={v.get('count')} since={v.get('sinceS')}s busy={v.get('busy')} armed={v.get('armed')} last={v.get('last')} tilt={pk.get('tiltDeg')}° rich={q.get('rich', {}).get('state')} ostentate={v.get('ostentateLeft')}")
    if errors:
        print("ERRORES JS:", errors[:3])
    browser.close()
