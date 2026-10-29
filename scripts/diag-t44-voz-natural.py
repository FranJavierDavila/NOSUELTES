#!/usr/bin/env python3
"""DIAGNÓSTICO — VOCES REALES DEL BANCO con disparadores NATURALES (sin force('voz')).

Petición del jugador: "No suenan mis audios que te he subido úsalos!".
El E2E T44 valida el pipeline FORZADO; este script mide si los DISPARADORES
NATURALES (susto + desplazamiento / escora) llegan a soltar voz en juego real:
  1. spawn → subir para que la tabla cuelgue en el aire (no grounded).
  2. sustos NATURALES vía debugForce('caida') (caída → chicote → panic →
     richScareVoice), 'drone' y 'boxes' (peso que escora la tabla).
  3. tras cada susto: muestrear voice.count + tiltDeg/slideFrac de la tabla.
Reporte: sustos disparados, voces soltadas naturalmente, tilt máximo visto.
"""
import json, time, urllib.request
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
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:500]}")

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

    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    print(f"SPAWN ok · voice={json.dumps(p.get('voice'))}")

    # subir para que la tabla cuelgue en el aire (grounded = center.y < 0.55)
    for _ in range(4):
        page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
        page.wait_for_timeout(700)
    p = wait_for(page, lambda q: (q.get("relief") or {}).get("viewBand", -1) >= 2, 40, "subida")
    plank0 = p.get("plank")
    print(f"TABLA en aire: {json.dumps(plank0)}")

    # sustos NATURALES: caída del jugador (chicote → panic), dron, cajas
    scares = ["caida", "drone", "boxes", "caida"]
    v0 = (probe(page) or {}).get("voice", {}).get("count", 0)
    tilt_max = 0.0
    fired = []
    for s in scares:
        before = (probe(page) or {}).get("voice", {}).get("count", 0)
        ok = page.evaluate(f"__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('{s}')")
        # muestrear 6 s tras el susto (pataleando dura 4 s + reacción de la tabla)
        samples = []
        for _ in range(40):
            page.wait_for_timeout(150)
            q = probe(page) or {}
            v = (q.get("voice") or {})
            pk = q.get("plank") or {}
            if pk.get("tiltDeg") is not None:
                tilt_max = max(tilt_max, abs(pk["tiltDeg"]))
            samples.append((v.get("count", 0), v.get("last"), round(pk.get("tiltDeg", 0), 1)))
        after = samples[-1][0]
        natural = after > before
        fired.append((s, ok, before, after, natural))
        peak_last = max((l for _, l, _ in samples if l), default=None)
        print(f"SUSTO {s:6s} ok={ok} voz {before}→{after} NATURAL={'SÍ' if natural else 'no'} · last={peak_last} · tilt_max={tilt_max:.1f}°")
        page.wait_for_timeout(2500)  # dejar pasar el cooldown (8 s) entre sustos
        page.wait_for_timeout(5500)

    total_natural = sum(1 for *_, n in fired if n)
    print(f"\nRESUMEN: {total_natural}/{len(scares)} sustos soltaron voz NATURAL · tilt máximo visto: {tilt_max:.1f}°")
    if errors:
        print("ERRORES JS:", errors[:3])
    browser.close()
