#!/usr/bin/env python3
"""Captura apuntada a los escaladores: proyecta las cinturas y recorta."""
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
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT esperando {label}")

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
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3, 30, "spawn")
    # espera al modelo
    t0 = time.time()
    while time.time() - t0 < 30:
        c = page.evaluate("__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null")
        if c and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    print("climber:", json.dumps(c))
    page.wait_for_timeout(800)

    for tag in ("0", "1"):
        w = page.evaluate(f"__SHERPAS_DEBUG.waist({tag})")
        pr = page.evaluate(f"p => __SHERPAS_DEBUG.project(p.x, p.y, p.z)", w)
        print(f"sherpa{tag} waist={json.dumps(w)} px={json.dumps(pr)}")

    # captura completa + recortes alrededor de las cinturas
    page.screenshot(path=f"{OUT}/t49-full.png")
    img_m = page.evaluate("""() => {
      const pts = [];
      for (const t of [0,1]) {
        const w = __SHERPAS_DEBUG.waist(t);
        pts.push(__SHERPAS_DEBUG.project(w.x, w.y, w.z));
      }
      return pts;
    }""")
    print("proyecciones:", json.dumps(img_m))
    browser.close()
