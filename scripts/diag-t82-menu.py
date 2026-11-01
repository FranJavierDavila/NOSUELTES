#!/usr/bin/env python3
"""T82d — dump del menú: todos los [data-a] y su visibilidad real."""
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
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    for i in range(10):
        page.wait_for_timeout(2000)
        if page.evaluate("!!window.__SHERPAS_DEBUG"):
            break
    page.wait_for_timeout(1500)
    info = page.evaluate("""(() => {
        const els = [...document.querySelectorAll('[data-a]')];
        return {
            total: els.length,
            items: els.slice(0, 20).map(e => ({
                a: e.getAttribute('data-a'),
                tag: e.tagName,
                vis: !!(e.offsetWidth || e.offsetHeight),
                text: (e.textContent || '').slice(0, 20),
            })),
            bodyChildren: [...document.body.children].map(c => c.id || c.className || c.tagName).slice(0, 8),
        };
    })()""")
    import json
    print(json.dumps(info, ensure_ascii=False, indent=1))
    browser.close()
