#!/usr/bin/env python3
"""T82c — clic en jugar + vigilar consola/errores: ¿muere el match al arrancar?"""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        page.on("console", lambda m: print("[console]", m.type, m.text[:200]))
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:280]))
        page.on("crash", lambda: print("[CRASH] la página ha muerto"))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        for i in range(15):
            page.wait_for_timeout(2000)
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                continue
            break
        print("debug instalado, clicando jugar…")
        clicked = page.evaluate("""(() => {
            const b = document.querySelector('button[data-a=go]');
            if (b && b.offsetParent) { b.click(); return true; }
            return false;
        })()""")
        print("clic:", clicked)
        for i in range(25):
            page.wait_for_timeout(2500)
            try:
                st = page.evaluate("""(() => ({
                    debug: !!window.__SHERPAS_DEBUG,
                    match: !!document.querySelector('canvas'),
                }))()""")
                rich = None
                if st["debug"]:
                    rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch (e) { return 'ERR:' + e.message; } })()")
                print(i, st, (rich if not isinstance(rich, dict) else {k: rich.get(k) for k in ("seated", "y", "phase")}))
            except Exception as e:
                print(i, "EXC", str(e)[:160])
                break
        browser.close()


if __name__ == "__main__":
    main()
