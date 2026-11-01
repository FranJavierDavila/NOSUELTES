#!/usr/bin/env python3
"""Sonda mínima: carga la página, espera y vuelca texto visible + captura."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text[:200]}") if m.type == "error" else None)
    resp = page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    print("HTTP:", resp.status if resp else "n/d")
    page.wait_for_timeout(15000)
    print("TITLE:", page.title())
    txt = page.evaluate("document.body ? document.body.innerText.slice(0, 600) : 'sin body'")
    print("BODY:", repr(txt))
    btns = page.evaluate("[...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 15)")
    print("BOTONES:", btns)
    page.screenshot(path="/home/z/my-project/download/diag-load.png")
    print("ERRORES:", errs[:8])
    browser.close()
print("ok")
