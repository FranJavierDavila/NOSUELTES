#!/usr/bin/env python3
"""T86 — captura del estado ACTUAL (pre-fix): match arrancado, sherpas escalando,
tabla + ricachón en reposo. Sirve para comparar antes/después de las 4 correcciones
(ricachón en el valle de la cuerda, caídas, manos prioritarias, mochila-chicle)."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3001/?clima=clear&hora=dia"
OUT = "/tmp/render"


def espera_seated(page, tope=200):
    t0 = time.time()
    while time.time() - t0 < tope:
        try:
            st = page.evaluate("""(() => ({
                debug: !!window.__SHERPAS_DEBUG,
                go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                skip: (() => { const s = document.querySelector('button[data-a=obSkip]'); return !!(s && (s.offsetWidth || s.offsetHeight)); })(),
                seated: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })(),
            }))()""")
            if st.get("seated"):
                return True
            if not st.get("debug"):
                page.wait_for_timeout(1500)
                continue
            if st.get("go"):
                page.evaluate("document.querySelector('button[data-a=go]').click()")
            elif st.get("skip"):
                page.evaluate("document.querySelector('button[data-a=obSkip]').click()")
            page.wait_for_timeout(1400)
        except Exception as e:
            print("EXC", str(e)[:110])
            page.wait_for_timeout(2500)
    return False


with sync_playwright() as pw:
    b = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    pg = b.new_page(viewport={"width": 480, "height": 360})
    pg.goto(URL, timeout=90000)
    ok = espera_seated(pg)
    print("seated:", ok)
    try:
        st = pg.evaluate("""(() => { const d=__SHERPAS_DEBUG; return {
          ric: d.richPose ? d.richPose() : null,
        };})()""")
        print("pose:", str(st)[:300])
    except Exception as e:
        print("pose EXC", str(e)[:200])
    pg.wait_for_timeout(900)
    try:
        pg.screenshot(path=f"{OUT}/t86-0-arranque.png", timeout=60000)
        print("captura ok")
    except Exception as e:
        print("shot EXC", str(e)[:160])
    b.close()
print("OK capturas en", OUT)
