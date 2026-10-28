#!/usr/bin/env python3
"""E2E Task 30 — racha MÁS EVIDENTE y menos letal + colas de cuerda.
Peticiones bajo prueba:
  (1) "el efecto debe ser mucho más evidente con partículas en la dirección
      del viento" → captura durante la racha (inspección visual de ráfagas).
  (2) "también empujan a los escaladores" → desplazamiento lateral real ≥0.15 m.
  (3) "que no sea tan fácil tirar al rico con una racha, pero que se note en
      la oscilación de la tabla" → tras la racha: fell=false, ricachón vivo,
      y shakeDeg > 0 durante la racha (oscilación visible).
  (4) "las cuerdas... un metro hacia abajo en ambos lados" → captura del plano
      de la tabla con las colas colgando bajo los cabos.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

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
        page.wait_for_timeout(250)
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:400]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda p: p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  plank={p['plank']}")

    # 2) calma inicial: captura de referencia (colas de cuerda en reposo)
    page.screenshot(path=f"{OUT}/t30-1-calma-colas.png")

    # 3) AVISO → RACHA
    t0 = time.time()
    p = wait_for(page, lambda p: p["weather"]["phase"] == "warn", 45, "aviso de viento")
    print(f"AVISO OK  weather={p['weather']}  t={time.time()-t0:.1f}s")
    page.screenshot(path=f"{OUT}/t30-2-aviso.png")

    p = wait_for(page, lambda p: p["weather"]["phase"] == "gust", 15, "racha")
    ax0, bx0 = p["a"]["x"], p["b"]["x"]
    print(f"RACHA OK  level={p['weather']['level']} dir={p['weather']['dir']} a.x0={ax0} b.x0={bx0}")

    # 4) durante la racha: empujón lateral + oscilación visible + captura de ráfagas
    max_dx, max_shake = 0.0, 0.0
    t_end = time.time() + 4.5
    shot = False
    while time.time() < t_end:
        p = probe(page)
        if not p:
            continue
        dx = max(abs(p["a"]["x"] - ax0), abs(p["b"]["x"] - bx0))
        max_dx = max(max_dx, dx)
        sh = abs((p["plank"] or {}).get("shakeDeg", 0))
        max_shake = max(max_shake, sh)
        if p["weather"]["level"] and p["weather"]["level"] > 0.75 and not shot:
            page.screenshot(path=f"{OUT}/t30-3-racha-particulas.png")
            shot = True
        if p["weather"]["phase"] == "calm":
            break
        page.wait_for_timeout(60)
    print(f"EMPUJÓN lateral: {max_dx:.3f} m (esperaba ≥ 0.15)")
    assert max_dx >= 0.15, "el empujón de la racha no se nota en los escaladores"
    print(f"OSCILACIÓN de tabla: pico {max_shake:.1f}° (esperaba > 1.5°)")
    assert max_shake > 1.5, "la tabla no oscila de forma visible con la racha"
    assert shot, "no se capturó la racha con partículas"

    # 5) vuelta a calma: el ricachón SIGUE en su tabla (la racha no lo despacha)
    p = wait_for(page, lambda p: p["weather"]["phase"] == "calm", 15, "calma")
    plank = p["plank"] or {}
    assert not plank.get("fell", True), "la racha tirió al ricachón (no debe)"
    assert p["hands"][0]["grips"] + p["hands"][1]["grips"] > 0, "los sherpas cayeron con la racha"
    page.screenshot(path=f"{OUT}/t30-4-calma-rico-vivo.png")
    print(f"CALMA OK  ricachón vivo (fell=false, slideFrac={plank.get('slide')})  racha aguanta el pico sin tirarlo")

    # 6) zoom a la tabla: colas de cuerda colgando de ambos cabos
    page.evaluate("""() => {
      const c = document.querySelector('canvas');
      if (c) { const r = c.getBoundingClientRect(); window.scrollTo(0, 0); }
    }""")
    page.screenshot(path=f"{OUT}/t30-5-tabla-colas.png", clip={"x": 320, "y": 260, "width": 640, "height": 420})

    # 7) sin errores JS
    if errors:
        print("ERRORES JS:", errors[:4])
        sys.exit(1)
    print("SIN ERRORES JS")
    browser.close()
    print("E2E T30: TODO OK")
