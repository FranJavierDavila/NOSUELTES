#!/usr/bin/env python3
"""Diagnóstico: ¿por qué el nivel no arranca en el puerto del t97?"""
import subprocess, time, sys, urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3107
BASE = f"http://127.0.0.1:{PORT}"

srv = subprocess.Popen(
    ["node", "/home/z/my-project/.next/standalone/server.js"],
    env={"PORT": str(PORT), "HOSTNAME": "127.0.0.1", "PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs, cons = [], []
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        page.on("console", lambda m: cons.append(f"{m.type}:{m.text[:120]}") if m.type in ("error", "warning") else None)
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        for i in range(40):
            time.sleep(2)
            v = page.evaluate("typeof window.__PARED !== 'undefined'")
            if v: break
        print("__PARED presente:", page.evaluate("typeof window.__PARED !== 'undefined'"))
        print("title:", page.title()[:80])
        print("pageerrors:", errs[:5])
        print("console err/warn:", cons[:8])
        browser.close()
finally:
    srv.terminate()
