import json, time
from playwright.sync_api import sync_playwright
URL = "http://localhost:3000"
def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    try: return json.loads(el.get_attribute("data-probe")) if el else None
    except Exception: return None
def wait_for(page, cond, t_s, label):
    t0=time.time(); last=None
    while time.time()-t0<t_s:
        p=probe(page); last=p
        if p and cond(p): return p
        page.wait_for_timeout(150)
    print(f"TIMEOUT {label}"); return last
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox","--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width":1280,"height":800})
    page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE"); page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"]>=3 and q["hands"][1]["grips"]>=3, 25, "spawn")
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
    q = wait_for(page, lambda q: (q["a"]["y"]+q["b"]["y"])/2 > 8, 14, "en alto")
    print("en alto:", q["checkpoints"], "a.y", q["a"]["y"], "b.y", q["b"]["y"])
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 0)")
    page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)")
    q = wait_for(page, lambda q: q["hands"][0]["grips"]>=2 and q["hands"][1]["grips"]>=2, 16, "respawn")
    print("RESPAWN:", json.dumps(q.get("respawn")), "a.y", q["a"]["y"], "b.y", q["b"]["y"], "cps", q["checkpoints"])
    browser.close()
