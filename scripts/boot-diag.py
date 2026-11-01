#!/usr/bin/env python3
"""Diagnóstico del arranque: consola + captura tras el click en GO."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 800, "height": 500})
    console = []
    page.on("console", lambda m: console.append((m.type, m.text[:200])))
    page.on("pageerror", lambda e: console.append(("PAGEERROR", str(e)[:200])))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    page.wait_for_timeout(8000)
    page.screenshot(path="/tmp/boot-2-tras-go.png")
    botones2 = page.evaluate("(() => [...document.querySelectorAll('button')].map(b => ({a: b.dataset.a, t: (b.textContent||'').slice(0,30), vis: !!b.offsetParent})).filter(b=>b.vis))()")
    print("botones tras GO:", botones2)
    print("debug:", page.evaluate("!!window.__SHERPAS_DEBUG"))
    errs = [m for m in console if m[0] in ("error", "PAGEERROR")]
    print(f"consola: {len(console)} msgs, {len(errs)} errores")
    for t, txt in errs[:10]:
        print(f"  [{t}] {txt}")
    browser.close()
print("ok")
