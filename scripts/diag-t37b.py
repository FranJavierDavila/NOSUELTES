import json, time
from playwright.sync_api import sync_playwright
URL = "http://localhost:3000"
def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    try: return json.loads(el.get_attribute("data-probe")) if el else None
    except Exception: return None
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox","--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width":1280,"height":800})
    page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE"); page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    t0=time.time()
    while time.time()-t0<25:
        q=probe(page)
        if q and q.get("hands") and q["hands"][0]["grips"]>=3 and q["hands"][1]["grips"]>=3: break
        page.wait_for_timeout(150)
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
    t0=time.time()
    while time.time()-t0<14:
        q=probe(page)
        if q and (q["a"]["y"]+q["b"]["y"])/2>8: break
        page.wait_for_timeout(150)
    page.wait_for_timeout(1500)
    print("PRE-CAIDA cps:", q["checkpoints"], "a", q["a"]["y"], "b", q["b"]["y"])
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 0)")
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)")
    t0=time.time()
    while time.time()-t0<14:
        q=probe(page)
        if q:
            print(f"t={time.time()-t0:4.1f}  a={q['a']['y']:6.2f} b={q['b']['y']:6.2f}  grips {q['hands'][0]['grips']}/{q['hands'][1]['grips']}  rope {[r['s'] for r in q['rope']]}  respawn={json.dumps(q.get('respawn'))}")
        page.wait_for_timeout(700)
    browser.close()
