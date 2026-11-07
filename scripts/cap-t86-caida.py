#!/usr/bin/env python3
"""T86 — caída del ricachón con cámara APUNTADA (camPin al pelvis cada frame)."""
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
        except Exception:
            page.wait_for_timeout(2500)
    return False


def pin_rich(page):
    """Apunta la cámara al pelvis del ricachón (proyección de la sonda rich())."""
    page.evaluate("""(() => {
      const r = __SHERPAS_DEBUG.rich();
      if (r) __SHERPAS_DEBUG.camPin(r.x, r.y, r.z, 3.2);
    })()""")


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
    pin_rich(pg)
    pg.wait_for_timeout(900)
    shot(pg, "t86c-0-sentado")
    pg.evaluate('__SHERPAS_DEBUG.force("caida_rico")')
    t = 0.0
    pasos = [0.35, 0.35, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5]
    for i, dt in enumerate(pasos):
        pg.wait_for_timeout(int(dt * 1000))
        t += dt
        pin_rich(pg)
        shot(pg, f"t86c-{i+1}-{int(t*10)}")
        try:
            st = pg.evaluate("""(() => { const r = __SHERPAS_DEBUG.richFall(); return r ? {s: r.seated, f: r.fell, y: r.pelvis.y, sp: r.speed} : null; })()""")
            print("t=%.1f" % t, st)
        except Exception:
            pass
    b.close()
print("OK")
