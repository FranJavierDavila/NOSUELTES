#!/usr/bin/env python3
"""T82 — verificación E2E en caliente de las 3 quejas del jugador:
1. Caras nuevas: pin de ánimo con cara (sorpresa→asustado) + sonda richFaces
   (loaded/active/headHidden) + captura visual de la cabeza del rico.
2. Bocadillo: proyección de la cabeza vs el UP actual (para dimensionar el
   salto sobre los anclajes).
3. Memoria frágil: viewport mínimo, una sola vida, sin reintentos eternos."""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def main():
    ok = {"arranque": False, "caras": None, "pin": None, "mood": None, "caps": 0}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        t0 = time.time()
        rich = None
        while time.time() - t0 < 200:
            try:
                if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && (b.offsetWidth || b.offsetHeight)) b.click(); })()")
                    page.wait_for_timeout(2500)
                    continue
                rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
                if rich and rich.get("seated"):
                    f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
                    if f and f.get("loaded") == 5:
                        ok["arranque"] = True
                        break
            except Exception:
                page.wait_for_timeout(2500)
        ok["caras"] = f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        ok["mood"] = m0 = page.evaluate("__SHERPAS_DEBUG.richMood()")
        # PIN de ánimo con cara: sorpresa → asustado (la cara debe salir)
        ok["pin"] = page.evaluate("__SHERPAS_DEBUG.richMood('sorpresa')")
        page.wait_for_timeout(1200)
        ok["pin_mood"] = page.evaluate("__SHERPAS_DEBUG.richMood()")
        ok["pin_faces"] = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        # cabeza del rico proyectada (para el bocadillo): partícula head del rico
        try:
            ok["rich_parts"] = page.evaluate("__SHERPAS_DEBUG.rich().y")
        except Exception:
            ok["rich_parts"] = None
        # capturas: general + zoom a la cabeza del rico (la posición la da la sonda)
        page.screenshot(path=f"{OUT}/t82-general.png")
        # el pin mantiene el ánimo: quítalo para no dejar la escena pinnada
        page.evaluate("__SHERPAS_DEBUG.richMood(null)")
        browser.close()
    print(json.dumps(ok, ensure_ascii=False, indent=1))
    return 0 if ok["arranque"] else 1


if __name__ == "__main__":
    sys.exit(main())
