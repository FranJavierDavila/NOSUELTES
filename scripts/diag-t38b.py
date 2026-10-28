import json, time
from playwright.sync_api import sync_playwright
URL = "http://localhost:3000"
def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    try: return json.loads(el.get_attribute("data-probe")) if el else None
    except Exception: return None
def wait_for(page, cond, t_s, label):
    t0=time.time()
    while time.time()-t0<t_s:
        p=probe(page)
        if p and cond(p): return p
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT {label}")
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox","--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width":1280,"height":800})
    page.goto(URL, wait_until="domcontentloaded"); page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE"); page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"]>=3, 25, "spawn")
    page.wait_for_timeout(800)
    q = probe(page)
    limbs = {f"{l['p']}_{l['l']}": l for l in q["limbs"]}
    hand = limbs["0_hand_r"]
    cands = [h for h in q["holds"] if abs(h["wx"]-hand["wx"])<1.2 and 0.05<(h["wy"]-hand["wy"])<0.9]
    print("A hand_r:", hand, "cands:", len(cands))
    if cands:
        t = min(cands, key=lambda h: abs(h["wy"]-(hand["wy"]+0.4)))
        px=lambda x: x*1280; py=lambda y: y*800
        page.mouse.move(px(hand["sx"]), py(hand["sy"])); page.mouse.down(); page.wait_for_timeout(150)
        page.mouse.move(px(t["sx"]), py(t["sy"]), steps=12); page.wait_for_timeout(250)
        q2 = probe(page)
        print("A drag durante:", json.dumps(q2.get("drag")), json.dumps(q2.get("dragReach")))
        page.mouse.up(); page.wait_for_timeout(400)
        q3 = probe(page)
        print("A tras up: grips=", q3["hands"][0]["grips"])
    browser.close()
