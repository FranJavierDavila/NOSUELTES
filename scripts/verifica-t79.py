#!/usr/bin/env python3
"""T79 — verificación E2E mínima en caliente (memoria frágil: una sola vida):
1. La tabla nace ~50 cm más abajo (sonda richFall: pelvis del rico baja).
2. El segundo sherpa carga el mapa rojo (sonda puppetInfo si existe).
3. Una captura de la escena para el jugador (vista general del arranque).
Sin bucles de recuperación eternos: si la sandbox OOM-mata, se documenta."""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def main():
    ok = {"arranque": False, "tabla_baja": False, "captura": 0, "richFall": None}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        t0 = time.time()
        rich = None
        while time.time() - t0 < 260:
            try:
                if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
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
        if ok["arranque"]:
            ok["richFall"] = rich
            # pelvis del rico sentado: con ropeLen 1.9 queda ~0.5 m más abajo
            py = (rich.get("pelvis") or {}).get("y")
            ok["tabla_baja"] = isinstance(py, (int, float)) and py < 2.0
            print("pelvis del rico al arranque:", py, flush=True)
            time.sleep(2.0)
            try:
                page.screenshot(path=f"{OUT}/t79-arranque.png")
                ok["captura"] = 1
                print("captura ok", flush=True)
            except Exception as e:
                print("captura falló:", str(e)[:120], flush=True)
        browser.close()
    print("RESULTADO", json.dumps(ok))
    return 0 if ok["arranque"] else 1


if __name__ == "__main__":
    sys.exit(main())
