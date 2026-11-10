#!/usr/bin/env python3
"""Diagnóstico T99: por qué el juego no arranca en el build exportado local."""
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/?test=escalada"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"])
    ctx = b.new_context(viewport={"width": 1000, "height": 500})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300], flush=True))
    page.on("console", lambda m: print("CONSOLA:", m.type, m.text[:200], flush=True) if m.type in ("error", "warning") else None)
    page.on("requestfailed", lambda r: print("REQFAIL:", str(r.failure)[:80], r.url[:120], flush=True))
    page.on("response", lambda r: print("HTTP", r.status, r.url[:120], flush=True) if r.status >= 400 else None)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    for i in range(8):
        time.sleep(5)
        try:
            st = page.evaluate("""(() => ({
                debug: !!window.__SHERPAS_DEBUG,
                title: document.title,
                botones: [...document.querySelectorAll('button')].map(b => b.textContent.slice(0,20)).slice(0,8),
                bodyLen: document.body ? document.body.innerText.length : 0,
                canvas: !!document.querySelector('canvas'),
            }))()""")
        except Exception as e:
            st = f"EXC {str(e)[:150]}"
        print(f"t={5*(i+1)}s", st, flush=True)
    page.screenshot(path="/home/z/my-project/download/t99-diag.png")
    b.close()
