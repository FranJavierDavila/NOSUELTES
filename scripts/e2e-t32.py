#!/usr/bin/env python3
"""E2E Task 32 — pared rocosa + círculo de alcance + minimapa detallado:
  (1) PARED ROCOSA: probe entrantes >= 0 + captura (aristas blancas/grietas).
  (2) MINIMAPA v2: canvas grande (336x880) + leyenda + metros + probe mmHolds.
  (3) CÍRCULO DE ALCANCE: arrastre cerca de presa → dragReach reachable=true
      (verde); captura.
  (4) ZONA ROJA + MUERTA: mover el puntero a roca vacía → reachable=false,
      deadZone=true; captura; soltar → la extremidad queda libre (gravedad,
      la mano cuelga más abajo) y el contador de anclas baja.
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

    # 1) menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  salientes={p.get('salientes')} entrantes={p.get('entrantes')}")

    # 2) PARED ROCOSA + MINIMAPA v2
    mm = page.eval_on_selector(".sphud [data-e=mmCanvas]", "e => ({w: e.width, h: e.height, vis: e.offsetParent !== null})")
    assert mm and mm["w"] == 336 and mm["h"] == 880 and mm["vis"], f"canvas del minimapa: {mm}"
    lg = [page.text_content(".sphud [data-e=mmLgPower]"), page.text_content(".sphud [data-e=mmLgIce]"), page.text_content(".sphud [data-e=mmLgSalient]")]
    assert all(x and x.strip() for x in lg), f"leyenda incompleta: {lg}"
    p = wait_for(page, lambda q: q.get("mmHolds", 0) > 5, 6, "presas en el minimapa")
    label = page.text_content(".sphud [data-e=mmLabel]").strip()
    print(f"MINIMAPA v2 OK  canvas {mm['w']}x{mm['h']}  mmHolds={p['mmHolds']}  leyenda={lg}  '{label}'")
    page.screenshot(path=f"{OUT}/t32-1-pared-rocosa-minimapa.png")

    # 3) CÍRCULO DE ALCANCE (verde): arrastrar hand_r del jugador 1 hacia una presa
    grips_before = p["hands"][0]["grips"]
    limbs = {f"{l['p']}_{l['l']}": l for l in p["limbs"]}
    hand = limbs["0_hand_r"]
    holds = p["holds"]
    # presa cercana por encima de la mano (alcanzable)
    cands = [h for h in holds if abs(h["wx"] - hand["wx"]) < 0.9 and -0.1 < (h["wy"] - hand["wy"]) < 0.75]
    assert cands, f"sin presas cercanas arriba de hand_r: {holds[:6]}"
    target = min(cands, key=lambda h: abs(h["wy"] - (hand["wy"] + 0.45)))
    px = lambda pct: page.viewport_size["width"] * pct / 100.0
    py = lambda pct: page.viewport_size["height"] * pct / 100.0
    page.mouse.move(px(hand["sx"]), py(hand["sy"]))
    page.mouse.down()
    page.wait_for_timeout(120)
    page.mouse.move(px(target["sx"]), py(target["sy"]), steps=12)
    p = wait_for(page, lambda q: q.get("dragReach") and q["dragReach"]["magnet"] and q["dragReach"]["reachable"] and not q["dragReach"]["deadZone"], 5, "imán verde alcanzable")
    print(f"ZONA VERDE OK  dragReach={p['dragReach']} (imán en {target['id']})")
    page.screenshot(path=f"{OUT}/t32-2-alcance-verde.png")

    # 4) ZONA ROJA + MUERTA: punto de roca vacía lejos de toda presa y de la mano
    def min_dist_holds(xpct, ypct):
        best = 1e9
        for h in holds:
            best = min(best, ((h["sx"] - xpct) ** 2 + (h["sy"] - ypct) ** 2) ** 0.5)
        return best
    best_pt, best_d = None, -1
    for xpct in range(6, 95, 4):
        for ypct in range(10, 90, 4):
            d = min_dist_holds(xpct, ypct)
            d_hand = ((hand["sx"] - xpct) ** 2 + (hand["sy"] - ypct) ** 2) ** 0.5
            if d > best_d and d_hand > 28:  # lejos de presas Y fuera del alcance
                best_pt, best_d = (xpct, ypct), d
    assert best_pt, "sin punto de zona muerta"
    page.mouse.move(px(best_pt[0]), py(best_pt[1]), steps=12)
    p = wait_for(page, lambda q: q.get("dragReach") and not q["dragReach"]["reachable"] and q["dragReach"]["deadZone"] and not q["dragReach"]["magnet"], 5, "zona roja + muerta")
    print(f"ZONA ROJA/MUERTA OK  dragReach={p['dragReach']}  punto={best_pt}")
    page.screenshot(path=f"{OUT}/t32-3-alcance-rojo-zona-muerta.png")

    # 5) SOLTAR en zona muerta: la extremidad queda LIBRE (gravedad) y cuelga
    page.mouse.up()
    p = wait_for(page, lambda q: q.get("drag") is None and q["hands"][0]["grips"] == grips_before - 1, 6, "ancla liberada en zona muerta")
    hand_after = {f"{l['p']}_{l['l']}": l for l in p["limbs"]}["0_hand_r"]
    time.sleep(1.2)
    p2 = probe(page)
    hand_hang = {f"{l['p']}_{l['l']}": l for l in p2["limbs"]}["0_hand_r"]
    assert hand_hang["wy"] < hand["wy"] - 0.5, f"la mano no cuelga: {hand['wy']} → {hand_hang['wy']}"
    print(f"SOLTAR EN MUERTA OK  anclas {grips_before}→{p2['hands'][0]['grips']}  mano wy {hand['wy']}→{hand_hang['wy']} (cuelga por gravedad)")
    page.screenshot(path=f"{OUT}/t32-4-mano-libre-cuelga.png")

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T32 COMPLETO — 0 errores JS")
    browser.close()
