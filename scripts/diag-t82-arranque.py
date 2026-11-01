#!/usr/bin/env python3
"""T82b — diagnóstico del arranque: consola del navegador + estado del menú."""
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
        page.on("console", lambda m: print("[console]", m.type, m.text[:220]))
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:300]))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        for i in range(20):
            page.wait_for_timeout(2000)
            state = page.evaluate("""(() => ({
                debug: !!window.__SHERPAS_DEBUG,
                canvas: !!document.querySelector('canvas'),
                buttons: [...document.querySelectorAll('button')].map(b => b.getAttribute('data-a') || b.textContent.slice(0, 24)).slice(0, 12),
                title: document.title,
            }))()""")
            print(i, state)
            if state["debug"]:
                break
        browser.close()


if __name__ == "__main__":
    main()
