#!/usr/bin/env python3
"""T86 — sonda de geometría: match arrancado + primer plano del centro (cuerda,
ricachón, sherpas) + volcado de posiciones (cinturas, anclas, nodos de cuerda,
centro/ángulo de tabla, pelvis del rico). Diagnóstico previo a las 4 correcciones."""
import time
import json
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


def shot(page, name):
    try:
        page.screenshot(path=f"{OUT}/{name}.png", timeout=45000)
        print("shot", name)
    except Exception as e:
        print("shot EXC", str(e)[:100])


with sync_playwright() as pw:
    b = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    pg = b.new_page(viewport={"width": 480, "height": 360})
    pg.goto(URL, timeout=90000)
    print("seated:", espera_seated(pg))

    geo = pg.evaluate("""(() => {
      const d = __SHERPAS_DEBUG;
      const out = {};
      try { out.waist = [d.waist(0), d.waist(1)]; } catch (e) { out.waist = String(e).slice(0,80); }
      try { out.anchors = [d.anchors(0), d.anchors(1)]; } catch (e) {}
      try { out.rich = d.rich(); } catch (e) {}
      try { out.harness = [(() => { const r = state_ref(); return null; })(), null]; } catch (e) {}
      // plank + nodos de cuerda vía match privado
      try {
        const m = d.matchDebug ? d.matchDebug() : null;
        if (m) { out.plank = m.plank; out.ropeNodes = m.ropeNodes; }
      } catch (e) { out.plankErr = String(e).slice(0, 90); }
      return out;
    })()""")
    print("GEO:", json.dumps(geo)[:900])

    # primer plano del centro: pelvis del rico
    try:
        r = geo.get("rich")
        if r:
            pg.evaluate(f"__SHERPAS_DEBUG.camPin({r['x']}, {r['y'] + 0.6}, {r['z']}, 3.4)")
            pg.wait_for_timeout(900)
            shot(pg, "t86g-0-centro-rico")
    except Exception as e:
        print("pin EXC", str(e)[:120])

    # plano general: punto medio entre las cinturas
    try:
        w = geo.get("waist")
        if isinstance(w, list) and w and w[0] and w[1]:
            mx = (w[0]["x"] + w[1]["x"]) / 2
            my = (w[0]["y"] + w[1]["y"]) / 2
            mz = (w[0]["z"] + w[1]["z"]) / 2
            pg.evaluate(f"__SHERPAS_DEBUG.camPin({mx}, {my}, {mz}, 7.5)")
            pg.wait_for_timeout(900)
            shot(pg, "t86g-1-general")
    except Exception as e:
        print("pin2 EXC", str(e)[:120])
    b.close()
print("OK")
