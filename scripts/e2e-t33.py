#!/usr/bin/env python3
"""E2E Task 33 — peticiones del jugador:
  (1) PARED 3D REAL: sonda debugForce("subir") → re-cuelga al equipo ~12 m más
      arriba; captura con HUECOS de entrantes, salientes irregulares y SOMBRAS.
  (2) CÍRCULO SUTIL: arrastre → dragReach verde (radio = alcance ya reducido por
      fatiga) + captura del trazo discontinuo.
  (3) POSTURAS CÓMICAS: esperar gesto nuevo (durmiendo/bailando/leyendo/telefono).
  (4) DRON REPARTIDOR: debugForce("drone") → approach → hover (captura) →
      delivered (cargoKg > 0, paquete sobre la tabla).
  (5) MINIMAPA: leyenda de entrantes presente.
  (6) 0 errores JS.
"""
import json, time
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
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  salientes={p.get('salientes')} entrantes={p.get('entrantes')}")
    assert p.get("entrantes", 0) > 0, "sin entrantes en esta semilla (no debería)"

    px = lambda pct: page.viewport_size["width"] * pct / 100.0
    py = lambda pct: page.viewport_size["height"] * pct / 100.0
    page.wait_for_timeout(4000)  # deja respirar el arranque

    # 2) CÍRCULO SUTIL: arrastrar una mano hacia una presa alcanzable
    for attempt in range(4):
        p = probe(page)
        limbs = {f"{l['p']}_{l['l']}": l for l in p["limbs"]}
        hand = limbs["0_hand_r"]
        cands = [h for h in p["holds"] if abs(h["wx"] - hand["wx"]) < 0.9 and 0.05 < (h["wy"] - hand["wy"]) < 0.75]
        assert cands, "sin presas cercanas arriba de hand_r"
        target = min(cands, key=lambda h: abs(h["wy"] - (hand["wy"] + 0.45)))
        page.mouse.move(px(hand["sx"]), py(hand["sy"]))
        page.mouse.down()
        page.wait_for_timeout(120)
        page.mouse.move(px(target["sx"]), py(target["sy"]), steps=12)
        p = probe(page)
        if p.get("dragReach") and p["dragReach"]["magnet"] and p["dragReach"]["reachable"]:
            break
        page.mouse.up()
        page.wait_for_timeout(700)
    else:
        raise SystemExit("el arrastre no encontró imán en 4 intentos")
    r = p["dragReach"]["reachM"]
    assert abs(r - 0.88 * 1.08) < 0.02, f"radio sin fatiga inesperado: {r}"
    page.screenshot(path=f"{OUT}/t33-2-circulo-discontinuo-verde.png")
    page.mouse.up()
    page.wait_for_timeout(500)
    print(f"CÍRCULO SUTIL OK  radio={r} (doble trazo discontinuo, sin disco)")

    # 3) POSTURAS CÓMICAS: esperar una de las 4 nuevas (la ruleta del aburrimiento)
    new_postures = {"durmiendo", "bailando", "leyendo", "telefono"}
    t0 = time.time()
    seen = None
    while time.time() - t0 < 90 and not seen:
        p = probe(page)
        g = (p or {}).get("rich", {}).get("gesture")
        if g in new_postures:
            seen = g
            break
        page.wait_for_timeout(300)
    assert seen, "90 s sin ver ninguna postura nueva (durmiendo/bailando/leyendo/telefono)"
    print(f"POSTURA OK  gesture={seen}")
    page.screenshot(path=f"{OUT}/t33-3-postura-{seen}.png")

    # 3b) PARED 3D REAL a media altura: sonda subir (~+12 m, presas firmes reales)
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')"), "sonda subir falló"
    p = wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 9.0, 12, "re-colgado a +12 m")
    print(f"SUBIDA OK  alt media {(p['a']['y'] + p['b']['y']) / 2:.2f} m")
    page.wait_for_timeout(1200)  # asienta la tabla tras el re-colgado (parejas a igual altura)
    page.screenshot(path=f"{OUT}/t33-1-pared-3d-huecos-sombras.png")
    print("PARED 3D capturada (huecos de entrantes + salientes + sombras)")

    # 4) DRON REPARTIDOR: forzado por sonda → vuelo + entrega
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('drone')"), "spawn del dron falló"
    p = wait_for(page, lambda q: q.get("drone") and q["drone"]["phase"] in ("approach", "hover"), 8, "dron en vuelo")
    print(f"DRON VUELA  phase={p['drone']['phase']} kg={p['drone']['kg']} frac={p['drone']['frac']}")
    wait_for(page, lambda q: q.get("drone") and q["drone"]["phase"] == "hover", 20, "hover del dron")
    page.screenshot(path=f"{OUT}/t33-4-dron-hover.png")
    p = wait_for(page, lambda q: q.get("drone") and q["drone"]["phase"] == "delivered", 15, "paquete entregado")
    cargo = wait_for(page, lambda q: q.get("cargoKg", 0) >= p["drone"]["kg"] - 0.5, 4, "carga en la tabla")
    print(f"PAQUETE ENTREGADO  kg={p['drone']['kg']} frac={p['drone']['frac']} cargoKg={cargo['cargoKg']}")
    page.screenshot(path=f"{OUT}/t33-5-paquete-en-la-tabla.png")

    # 5) MINIMAPA: leyenda con los 4 tipos (poder/hielo/saliente/entrante)
    lg = [page.text_content(".sphud [data-e=mmLgPower]"), page.text_content(".sphud [data-e=mmLgIce]"),
          page.text_content(".sphud [data-e=mmLgSalient]"), page.text_content(".sphud [data-e=mmLgRecess]")]
    assert all(x and x.strip() for x in lg), f"leyenda incompleta: {lg}"
    print(f"MINIMAPA OK  leyenda={lg}  mmHolds={probe(page)['mmHolds']}")

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T33 COMPLETO — 0 errores JS")
    browser.close()
