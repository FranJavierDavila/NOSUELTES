#!/usr/bin/env python3
"""Cazar la navegación espontánea tras GO (execution context destroyed)."""
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("crash", lambda p: (print("!!! PAGE CRASH !!!"), errors.append("CRASH")))
    page.on("framenavigated", lambda f: print(f"NAVIGATED: {f.url[:80]}"))
    page.on("request", lambda r: print(f"  REQ {r.resource_type}: {r.url[:90]}") if r.resource_type == "document" else None)
    page.on("console", lambda m: print(f"  consola[{m.type}]: {m.text[:160]}"))

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
    page.click("text=SHERPAS AL LÍMITE", timeout=8000)
    page.wait_for_selector("button[data-a=go]", timeout=60000)
    page.click("button[data-a=go]")
    print("GO pulsado", flush=True)
    for i in range(8):
        page.wait_for_timeout(3000)
        try:
            st = page.evaluate("(function(){try{return {tex:!!__SHERPAS_DEBUG.sceneObj().strataTex, n:1};}catch(e){return {err:String(e).slice(0,80)};}})()")
            print(f"  t+{(i+1)*3}s sonda segura: {st} erroresJS={len(errors)}", flush=True)
        except Exception as e:
            print(f"  t+{(i+1)*3}s EXCEPCIÓN: {type(e).__name__} {str(e)[:90]}", flush=True)
    print("errores JS:", errors[:4])
    browser.close()
