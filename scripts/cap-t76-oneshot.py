#!/usr/bin/env python3
"""Captura T76 one-shot: pin de ánimo → primer plano de la cara + bocadillo.

La sesión muere por recargas del dev (OOM del sandbox) tras ~1 min, así que:
recuperar → pinear → capturar TODO en la primera ventana estable. 3 intentos.
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def alive(page):
    try:
        return page.evaluate("1") == 1
    except Exception:
        return False


def recover(page, tag):
    """Menú→tutorial→rico→caras cargadas. True si la sesión queda lista."""
    # OJO: alive() es True también en about:blank (evaluate funciona ahí);
    # decidir por URL, no por "el contexto responde".
    if "localhost:3000" not in (page.url or ""):
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    aviso = 0.0
    while time.time() - t0 < 150:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                if time.time() - aviso > 10:
                    aviso = time.time()
                    menu = page.evaluate("(() => document.body ? document.body.innerText.slice(0, 90).replace(/\\n/g, ' / ') : '(sin body)')()")
                    print(f"[{tag}] sin debug; página: {menu}", flush=True)
                page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
                page.wait_for_timeout(2000)
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
            if rich and rich.get("pelvis"):
                f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
                if f and f.get("loaded") == 5:
                    return rich
                if time.time() - aviso > 15:
                    aviso = time.time()
                    print(f"[{tag}] pelvis ok, caras {json.dumps(f)}", flush=True)
                page.wait_for_timeout(2000)
                continue
            if time.time() - aviso > 15:
                aviso = time.time()
                menu = page.evaluate("(() => document.body ? document.body.innerText.slice(0, 90).replace(/\\n/g, ' / ') : '')()")
                print(f"[{tag}] sin richFall; página: {menu}", flush=True)
            for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
                try:
                    page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
                except Exception:
                    pass
        except Exception as e:
            if not alive(page) or "localhost:3000" not in (page.url or ""):
                print(f"[{tag}] contexto muerto, reload", flush=True)
                page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            elif time.time() - aviso > 15:
                aviso = time.time()
                print(f"[{tag}] eval-err {str(e)[:80]}", flush=True)
        page.wait_for_timeout(2000)
    return None


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))

        for intento in range(1, 4):
            print(f"--- intento {intento} ---", flush=True)
            rich = recover(page, f"i{intento}")
            if not rich:
                print("sin sesión", flush=True)
                try:
                    page.close()  # libera la memoria del renderer entre intentos
                except Exception:
                    pass
                page = browser.new_page(viewport={"width": 256, "height": 192})
                page.on("pageerror", lambda e: errs.append(str(e)[:200]))
                time.sleep(20)  # margen para que el sandbox recupere memoria
                continue
            print("sesión lista:", json.dumps(rich.get("pelvis")), flush=True)
            try:
                ret = page.evaluate("__SHERPAS_DEBUG.richMood('enfado')")
                f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
                print("pin ->", ret, json.dumps(f), flush=True)
                if not f or f.get("active") != "enfadado":
                    continue
                p = rich["pelvis"]
                page.evaluate(f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
                  s.camTarget.set ? s.camTarget.set({p['x']}, {p['y'] + 1.0}, {p['z']}) : (s.camTarget = {{x:{p['x']}, y:{p['y'] + 1.0}, z:{p['z']}}});
                  s.orbitYaw = 0.0; s.orbitPitch = 0.1; s.camDist = 1.35; return true; }})()""")
                page.wait_for_timeout(2500)
                page.screenshot(path=f"{OUT}/t76-cara_closeup.png")
                print("captura closeup ok", flush=True)
                said = False
                for _ in range(6):
                    try:
                        said = page.evaluate("__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
                    except Exception:
                        said = False
                        if not alive(page):
                            break
                    if said:
                        break
                    page.wait_for_timeout(1200)
                print("richSay ->", said, flush=True)
                page.wait_for_timeout(900)
                if alive(page):
                    page.screenshot(path=f"{OUT}/t76-bocadillo2.png")
                    print("captura bocadillo ok", flush=True)
                    print("pageerrors:", len(errs), errs[:2], flush=True)
                    browser.close()
                    return 0
            except Exception as e:
                print("fallo en ventana:", str(e)[:150], flush=True)
        browser.close()
        return 1


sys.exit(main())
