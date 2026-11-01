#!/usr/bin/env python3
"""Diagnóstico del arranque del juego: errores de consola + captura del estado."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 512, "height": 384})
    errs = []
    page.on("pageerror", lambda e: errs.append(f"PAGEERROR: {e}"))
    page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text[:300]}"))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    for i in range(20):
        time.sleep(5)
        try:
            has = page.evaluate("!!window.__SHERPAS_DEBUG")
        except Exception as e:
            has = f"eval-err: {str(e)[:120]}"
        btns = page.evaluate("(() => Array.from(document.querySelectorAll('button')).slice(0,6).map(b => b.textContent || b.dataset.a).join(' | '))()") if i % 4 == 0 else "."
        print(f"t={ (i+1)*5 }s debug={has} botones={btns}", flush=True)
        if has is True:
            break
        try:
            page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
        except Exception:
            pass
    print("--- errores ---", flush=True)
    for e in errs[:15]:
        print(e, flush=True)
    page.screenshot(path="/tmp/diag-arranque.png")
    print("captura /tmp/diag-arranque.png", flush=True)
    browser.close()
