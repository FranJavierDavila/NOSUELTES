#!/usr/bin/env python3
"""DIAGNÓSTICO LIMPIO — sustos naturales EN CALMA (no durante caídas de equipo).
Espera a estado estable (tabla colgada, fell=False, cooldown pasado) y fuerza
'caida' (suelta 4 extremidades → chicote → panic → richScareVoice). Con el fix,
CADA susto limpio debe soltar una voz real del banco del jugador (count++)."""
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

    results = []
    for round_n in range(4):
        # ESPERAR CALMA: tabla colgada estable (no fell, no grounded), cooldown pasado
        p = wait_for(page, lambda q: (q.get("plank") or {}).get("fell") is False
                     and (q.get("plank") or {}).get("tiltDeg") is not None
                     and abs((q.get("plank") or {}).get("tiltDeg", 99)) < 8
                     and ((q.get("voice") or {}).get("sinceS", 0) > 8.5), 60, f"calma r{round_n}")
        v0 = p["voice"]["count"]
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
        # 8 s de muestreo: ¿count sube? ¿con qué fichero? ¿brazos en alto?
        fired = None
        hands_peak = [0.0, 0.0]
        for _ in range(53):
            page.wait_for_timeout(150)
            q = probe(page) or {}
            v = q.get("voice") or {}
            if v.get("count", 0) > v0 and fired is None:
                fired = (v.get("last"), v.get("count"))
            hu = v.get("handsUp") or [0, 0]
            hands_peak = [max(hands_peak[0], hu[0] or 0), max(hands_peak[1], hu[1] or 0)]
        ok = fired is not None
        results.append(ok)
        print(f"SUSTO {round_n+1}: voz {'SÍ → ' + str(fired) if ok else 'NO'} · brazos pico {hands_peak[0]:+.2f}/{hands_peak[1]:+.2f} m sobre pecho")

    print(f"RESUMEN: {sum(results)}/{len(results)} sustos limpios soltaron voz real NATURAL")
    if errors:
        print("ERRORES JS:", errors[:3])
    browser.close()
