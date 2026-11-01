#!/usr/bin/env python3
"""T76 — capturas rápidas restantes: cara enfadada + bocadillo con texto."""
import json
import time
from playwright.sync_api import sync_playwright

OUT = "/home/z/my-project/download"


def cam(pelvis, dy, dist):
    px, py, pz = pelvis["x"], pelvis["y"], pelvis["z"]
    return f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
      s.camTarget.set ? s.camTarget.set({px}, {py + dy}, {pz}) : (s.camTarget = {{x:{px}, y:{py + dy}, z:{pz}}});
      s.orbitYaw = 0; s.orbitPitch = 0.12; s.camDist = {dist}; return true; }})()"""


def shot(page, path):
    try:
        page.screenshot(path=path, timeout=12000)
        print("ok", path.split("/")[-1], flush=True)
        return True
    except Exception as e:
        print("shot fallo:", str(e)[:80], flush=True)
        return False


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                       "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:3000/?clima=clear&hora=dia", wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=60000)
    page.evaluate("document.querySelector('button[data-a=go]').click()")
    rich = None
    t0 = time.time()
    while time.time() - t0 < 140:
        page.wait_for_timeout(4000)
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
                    try:
                        page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
                    except Exception:
                        pass
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch {{ return null; }} })()")
        except Exception:
            rich = None
        if rich and rich.get("pelvis"):
            break
    if not rich or not rich.get("pelvis"):
        raise SystemExit("sin rico")
    # caras cargadas
    t0 = time.time()
    faces = None
    while time.time() - t0 < 60:
        try:
            faces = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if faces and faces.get("loaded") == 5:
                break
        except Exception:
            pass
        page.wait_for_timeout(3000)
    print("faces:", json.dumps(faces), flush=True)
    pelvis = rich["pelvis"]
    page.evaluate("__SHERPAS_DEBUG.richMood('enfado')")
    page.wait_for_timeout(5000)
    print("faces2:", json.dumps(page.evaluate("__SHERPAS_DEBUG.richFaces()")), flush=True)
    page.evaluate(cam(pelvis, 1.0, 1.9))
    page.wait_for_timeout(1500)
    shot(page, f"{OUT}/t76-cara_enfadado.png")
    said = False
    for _ in range(8):
        try:
            said = page.evaluate("__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
        except Exception:
            said = False
        if said:
            break
        page.wait_for_timeout(1200)
    print("richSay ->", said, flush=True)
    page.evaluate(cam(pelvis, 0.9, 2.3))
    page.wait_for_timeout(1200)
    shot(page, f"{OUT}/t76-bocadillo.png")
    try:
        print("richMood:", json.dumps(page.evaluate("__SHERPAS_DEBUG.richMood()")), flush=True)
    except Exception:
        pass
    browser.close()
print("done")
