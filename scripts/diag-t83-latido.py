#!/usr/bin/env python3
"""T83-latido — estado cada 8 s: debug / botón / rich / título."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3001/?clima=clear&hora=dia"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    page = browser.new_page(viewport={"width": 256, "height": 192})
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:160]))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    last = ""
    while time.time() - t0 < 100:
        try:
            st = page.evaluate("""(() => {
                const b = document.querySelector('button[data-a=go]');
                return {
                    debug: !!window.__SHERPAS_DEBUG,
                    go: !!(b && (b.offsetWidth || b.offsetHeight)),
                    menu: (document.body.innerText || '').slice(0, 60).replace(/\\n/g, '|'),
                    rich: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return r ? (r.seated ? 'SEATED' : 'fase:' + (r.phase ?? JSON.stringify(r).slice(0, 60))) : 'null'; } catch (e) { return 'ERR'; } })(),
                };
            })()""")
            line = f"[{time.time()-t0:5.1f}s] {st}"
            if line != last:
                print(line)
                last = line
            if st["debug"] and st["go"]:
                page.evaluate("document.querySelector('button[data-a=go]').click()")
                print(f"[{time.time()-t0:5.1f}s] CLIC emitido")
                page.wait_for_timeout(1500)
                continue
            # onboarding: saltar cada paso
            page.evaluate("(() => { const s = document.querySelector('button[data-a=obSkip]'); if (s && (s.offsetWidth || s.offsetHeight)) s.click(); })()")
            if st["rich"] == "SEATED":
                print("ARRANQUE COMPLETO")
                break
        except Exception as e:
            print(f"[{time.time()-t0:5.1f}s] EXC", str(e)[:100])
        page.wait_for_timeout(2000)
    browser.close()
