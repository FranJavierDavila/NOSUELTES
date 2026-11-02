#!/usr/bin/env python3
"""T83-loop — diagnóstico verboso del arranque del match: ¿se clica ¡GO!?
¿llega seated? ¿qué devuelve richFall en cada fase?"""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    page = browser.new_page(viewport={"width": 256, "height": 192})
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
    page.on("crash", lambda: print("[CRASH]"))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    clicked = 0
    while time.time() - t0 < 150:
        try:
            st = page.evaluate("""(() => {
                const b = document.querySelector('button[data-a=go]');
                return {
                    debug: !!window.__SHERPAS_DEBUG,
                    goVisible: !!(b && (b.offsetWidth || b.offsetHeight)),
                    rich: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return r ? (r.seated ? 'seated' : JSON.stringify(r).slice(0, 90)) : null; } catch (e) { return 'ERR:' + e.message; } })(),
                };
            })()""")
            if st["debug"] and st["goVisible"] and clicked < 3:
                page.evaluate("document.querySelector('button[data-a=go]').click()")
                clicked += 1
                print(f"[{time.time()-t0:5.1f}s] clic #{clicked}")
            if clicked and (time.time() - t0) % 1 < 0.5:
                pass
            if st["rich"] == "seated":
                print(f"[{time.time()-t0:5.1f}s] SEATED — el match arrancó")
                break
            if st["rich"] and st["rich"] != "seated":
                print(f"[{time.time()-t0:5.1f}s] rich: {st['rich']}")
            elif clicked and (time.time() - t0) > 20:
                print(f"[{time.time()-t0:5.1f}s] estado: {st}")
            page.wait_for_timeout(1200)
        except Exception as e:
            print(f"[{time.time()-t0:5.1f}s] EXC", str(e)[:120])
            page.wait_for_timeout(2000)
    browser.close()
