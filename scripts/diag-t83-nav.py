#!/usr/bin/env python3
"""T83-nav — ¿QUIÉN navega y a DÓNDE ~40 s tras el clic?"""
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
    page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
    page.on("crash", lambda: print("[CRASH]"))
    page.on("framenavigated", lambda f: print("[NAV]", f.url[:120]))
    page.on("requestfailed", lambda r: print("[reqFAIL]", r.url[:100], r.failure))
    page.on("response", lambda r: print("[resp]", r.status, r.url[:100]) if r.status >= 400 else None)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    clicked = False
    while time.time() - t0 < 120:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                b = page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); return b && (b.offsetWidth || b.offsetHeight); })()")
                if b and not clicked:
                    page.evaluate("document.querySelector('button[data-a=go]').click()")
                    clicked = True
                    print(f"[{time.time()-t0:5.1f}s] clic")
                page.wait_for_timeout(1500)
                continue
            rich = page.evaluate("(() => { try { const r = __SHERPAS_DEBUG.richFall(); return r ? r.seated : null; } catch { return null; } })()")
            if rich:
                print(f"[{time.time()-t0:5.1f}s] SEATED")
                break
            page.wait_for_timeout(1500)
        except Exception as e:
            print(f"[{time.time()-t0:5.1f}s] EXC", str(e)[:100])
            try:
                print("   url ahora:", page.url[:120])
                page.wait_for_timeout(4000)
            except Exception:
                pass
    browser.close()
