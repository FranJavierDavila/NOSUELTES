#!/usr/bin/env python3
"""T86 — captura del VALLE de la cuerda: ricachón colgado del punto más bajo
del arco (no del nudo medio) + piernas visibles. Sonda numérica + primer plano."""
import time
import json
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3100/NOSUELTES/?nivel=pared"
OUT = "/tmp/render"


def espera_jugando(page, tope=240):
    t0 = time.time()
    while time.time() - t0 < tope:
        try:
            st = page.evaluate("""(() => {
              const w = window.__PARED;
              if (!w || !w.sonda) return { s: null };
              const s = w.sonda();
              return { s: s.state };
            })()""")
            if st.get("s") == "jugando":
                return True
            page.wait_for_timeout(1400)
        except Exception as e:
            print("EXC", str(e)[:100])
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
    pg = b.new_page(viewport={"width": 560, "height": 420})
    pg.context.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    pg.goto(URL, timeout=90000, wait_until="domcontentloaded")
    print("jugando:", espera_jugando(pg))

    # sonda numérica: el amarre debe estar en el VALLE (nudoX ≈ valleX)
    ric = pg.evaluate("""(() => {
      const s = window.__PARED.sonda();
      return { ricachon: s.ricachon, muelles: s.muelles };
    })()""")
    print("SONDA:", json.dumps(ric)[:420])
    r = (ric.get("ricachon") or {})
    vx, vy = r.get("valleX"), r.get("valleY")
    if isinstance(vx, (int, float)):
        # primer plano del valle: valleY es relativo a Y_SALIDA 2.2
        pg.evaluate(f"""(() => {{
          const sc = window.__PARED && window.__PARED.d && window.__PARED.d.scene;
          if (sc && sc.setCamPin) sc.setCamPin({{ x: {vx}, y: {2.2 + (vy or -1)}, z: 0.1 }}, 3.2);
        }})()""")
        pg.wait_for_timeout(900)
        shot(pg, "t86v-0-primer-plano-valle")
        pg.evaluate("""(() => {
          const sc = window.__PARED && window.__PARED.d && window.__PARED.d.scene;
          if (sc && sc.setCamPin) sc.setCamPin(null);
        })()""")
        pg.wait_for_timeout(700)
    shot(pg, "t86v-1-general")
    b.close()
print("OK")
