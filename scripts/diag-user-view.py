#!/usr/bin/env python3
"""Diagnóstico «¿qué ve el usuario?»: entra en partida, lee sondas richPuppet/clima,
cuenta errores de consola+shader y captura pared y ricachón."""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"

console_msgs = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: console_msgs.append(("PAGEERROR", str(e)[:300])))
    page.on("console", lambda m: console_msgs.append((m.type, m.text[:300]))
            if m.type in ("error", "warning") else None)

    page.goto(URL, wait_until="domcontentloaded")
    ok = False
    for ronda in range(3):
        try:
            page.wait_for_selector("button[data-a=go]", timeout=90000)
            ok = True
            break
        except Exception:
            try:
                page.click("text=SHERPAS AL LÍMITE", timeout=8000)
                page.wait_for_selector("button[data-a=go]", timeout=30000)
                ok = True
                break
            except Exception:
                page.goto(URL, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
    if not ok:
        print("FALLO: no se alcanzó el menú de partida")
        browser.close()
        raise SystemExit(1)

    page.evaluate("document.querySelector('button[data-a=go]').click()")
    page.wait_for_timeout(1500)
    for _ in range(8):
        try:
            if not page.evaluate("(() => { const b = document.querySelector('[data-a=obNext]'); if (!b || !b.offsetParent) return false; b.click(); return true; })()"):
                break
        except Exception:
            break
        page.wait_for_timeout(500)

    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                break
        except Exception:
            pass
        page.wait_for_timeout(2000)
    page.wait_for_timeout(12000)

    info = {}
    try:
        info["richPuppet"] = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.richPuppet && __SHERPAS_DEBUG.richPuppet()")
    except Exception as e:
        info["richPuppet"] = f"ERR {e}"
    try:
        c = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.climate && __SHERPAS_DEBUG.climate()")
        if c:
            info["clima"] = {
                "active": c.get("active"), "plugins": c.get("plugins"),
                "wetness": c.get("wetness"), "frost": c.get("frost"),
                "freezeY": c.get("freezeY"),
                "ubo_layoutBuilt": c.get("ubo") and c["ubo"].get("layoutBuilt"),
                "ubo_plugins": c.get("ubo") and c["ubo"].get("plugins"),
                "n_perPlugin": len(c.get("perPlugin") or []),
            }
    except Exception as e:
        info["clima"] = f"ERR {e}"
    try:
        pelvis = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rich && __SHERPAS_DEBUG.rich()")
        if pelvis:
            info["rich_pos"] = {k: round(pelvis[k], 2) for k in ("x", "y", "z")}
            p = page.evaluate(f"window.__SHERPAS_DEBUG.project({pelvis['x']}, {pelvis['y']}, {pelvis['z']})")
            if p:
                info["rich_pantalla"] = {k: int(v) for k, v in p.items()}
    except Exception:
        pass

    errs = [m for m in console_msgs if m[0] in ("error", "PAGEERROR")]
    shader = [m for m in console_msgs if any(k in m[1].lower() for k in ("shader", "uniform", "undeclared", "compile"))]
    print(json.dumps(info, ensure_ascii=False, indent=1, default=str))
    print(f"consola: {len(console_msgs)} msgs, {len(errs)} errores, {len(shader)} shader-related")
    for m in (errs[:6] + shader[:6]):
        print("  ", m[0], "|", m[1][:160])

    page.screenshot(path=f"{OUT}/diag-vista-1-general.png")
    if isinstance(info.get("rich_pantalla"), dict):
        x, y = info["rich_pantalla"]["x"], info["rich_pantalla"]["y"]
        print(f"RICH en pantalla: x={x} y={y}")
    browser.close()

from PIL import Image
im = Image.open(f"{OUT}/diag-vista-1-general.png").convert("L")
h = im.histogram()
print("captura:", im.size, "no-blanco:", round(1 - h[255] / sum(h), 3), "no-negro:", round(1 - h[0] / sum(h), 3))
print("ok")
