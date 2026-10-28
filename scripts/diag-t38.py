#!/usr/bin/env python3
"""Diagnóstico T38: por qué el drag de re-agarre sobre B colgado no agarra."""
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

def wait_for(page, cond, timeout_s, label, soft=False):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    if soft:
        return None
    raise SystemExit(f"TIMEOUT {label}: {json.dumps(last)[:500]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    # subir y soltar a B
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
    wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 8, 14, "en alto")
    page.wait_for_timeout(1200)
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)")
    wait_for(page, lambda q: q["rope"][1]["s"] == "caught", 6, "caught")
    wait_for(page, lambda q: q["rope"][1]["drop"] <= 1.4, 12, "recobrado")
    q = probe(page)
    print("ESTADO B tras recobro:", json.dumps({k: q[k] for k in ("b", "rope", "hands")}))
    limbs = {f"{l['p']}_{l['l']}": l for l in q["limbs"]}
    for k, l in limbs.items():
        if k.startswith("1_"):
            print(f"  {k}: sx={l['sx']} sy={l['sy']} wx={l['wx']} wy={l['wy']}")
    hand = limbs["1_hand_r"]
    cands = [h for h in q["holds"] if abs(h["wx"] - hand["wx"]) < 1.2 and 0.05 < (h["wy"] - hand["wy"]) < 0.9]
    print(f"candidatas ({len(cands)}):", [(h["id"], round(h["wx"], 2), round(h["wy"], 2), h["sx"], h["sy"]) for h in cands[:6]])
    if not cands:
        print("TODAS las presas de la sonda:", [(h["id"], round(h["wx"], 2), round(h["wy"], 2)) for h in q["holds"][:15]])
        print("b.y =", q["b"]["y"])
    else:
        target = min(cands, key=lambda h: abs(h["wy"] - (hand["wy"] + 0.4)))
        px = lambda pct: 1280 * pct / 100.0
        py = lambda pct: 800 * pct / 100.0
        print(f"target {target['id']} sx={target['sx']} sy={target['sy']}")
        page.mouse.move(px(hand["sx"]), py(hand["sy"]))
        page.mouse.down()
        page.wait_for_timeout(150)
        page.mouse.move(px(target["sx"]), py(target["sy"]), steps=14)
        page.wait_for_timeout(250)
        q2 = probe(page)
        print("DURANTE drag:", json.dumps({k: q2[k] for k in ("drag", "dragReach", "hands") if k in q2}))
        page.mouse.up()
        page.wait_for_timeout(500)
        q3 = probe(page)
        print("TRAS up:", json.dumps({k: q3[k] for k in ("rope", "hands")}))
        print("TENSIONES B:", [(l["l"], l["t"]) for l in q3["limbs"] if l["p"] == 1])
    browser.close()
