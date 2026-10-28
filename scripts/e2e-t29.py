#!/usr/bin/env python3
"""E2E Task 29 — rachas de viento + chips de extremidades + cuerda verlet.
Flujo: menú → SHERPAS → GO → sondeo data-probe: (1) chips presentes;
(2) aviso warn y racha gust con desplazamiento lateral REAL de los sherpas;
(3) sin errores de página; capturas de cada fase."""
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

    # 1) elegir SHERPAS
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")

    # 2) partida viva: sherpas anclados
    p = wait_for(page, lambda p: p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  a=({p['a']['x']},{p['a']['y']})  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  weather={p['weather']}")

    # 3) chips de extremidades presentes (papel claro de los indicadores)
    n_chips = page.evaluate("document.querySelectorAll('.sphud .limb').length")
    assert n_chips == 8, f"esperaba 8 chips, hay {n_chips}"
    clases = page.evaluate("[...document.querySelectorAll('.sphud .limb')].map(e=>e.className)")
    print(f"CHIPS OK  8 chips  clases[0]={clases[0]}")
    tip = page.evaluate("document.querySelector('.sphud .limb')?.getAttribute('title') ?? ''")
    assert "fatiga" in tip or "fatigue" in tip.lower(), f"chip sin tooltip legible: {tip!r}"
    print("TOOLTIP OK")

    # 4) AVISO de racha (warn) y luego RACHA (gust)
    t0 = time.time()
    p = wait_for(page, lambda p: p["weather"]["phase"] == "warn", 45, "aviso de viento")
    print(f"AVISO OK  weather={p['weather']}  t={time.time()-t0:.1f}s")
    page.screenshot(path=f"{OUT}/t29-1-aviso-viento.png")

    pre_gust = wait_for(page, lambda p: p["weather"]["phase"] == "gust", 15, "racha")
    ax0 = pre_gust["a"]["x"]
    print(f"RACHA OK  level={pre_gust['weather']['level']} dir={pre_gust['weather']['dir']} ax0={ax0}")

    # 5) durante la racha los cuerpos SE MUEVEN lateralmente
    max_dx = 0.0
    t_end = time.time() + 4.0
    while time.time() < t_end:
        p = probe(page)
        if not p:
            continue
        dx = abs(p["a"]["x"] - ax0)
        if dx > max_dx:
            max_dx = dx
            if p["weather"]["level"] and p["weather"]["level"] > 0.6:
                page.screenshot(path=f"{OUT}/t29-2-racha-viento.png")
        if p["weather"]["phase"] == "calm":
            break
        page.wait_for_timeout(120)
    print(f"DESPLAZAMIENTO durante racha: {max_dx:.3f} m (esperaba ≥ 0.05)")
    assert max_dx >= 0.05, "la racha no empujó a los sherpas"

    # 6) vuelta a calma + la partida sigue viva
    p = wait_for(page, lambda p: p["weather"]["phase"] == "calm", 15, "calma")
    assert p["hands"][0]["grips"] + p["hands"][1]["grips"] > 0, "los sherpas murieron con la racha"
    page.screenshot(path=f"{OUT}/t29-3-calma.png")
    print("CALMA OK  la partida sigue viva")

    # 7) una segunda racha llega (ritmo de variedad)
    p = wait_for(page, lambda p: p["weather"]["phase"] in ("warn", "gust"), 40, "segunda racha")
    print(f"SEGUNDA RACHA OK  fase={p['weather']['phase']}")

    # 8) sin errores JS
    if errors:
        print("ERRORES JS:", errors[:4])
        sys.exit(1)
    print("SIN ERRORES JS")
    browser.close()
    print("E2E T29: TODO OK")
