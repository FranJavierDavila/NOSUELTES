#!/usr/bin/env python3
"""Captura T109 — campamento base con la cabaña TEXTURIZADA + HUMO de
chimenea + el tono rojizo de las paredes. Puerto 3101 (el E2E usa el 3100)."""
import subprocess
import sys
import time
from pathlib import Path

Path("/home/z/my-project/download/T109-capturas").mkdir(parents=True, exist_ok=True)

BASE = "http://127.0.0.1:3101/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3101"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--js-flags=--max-old-space-size=300",
        ])
        page = browser.new_context(viewport={"width": 300, "height": 200}).new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(12):
            try:
                page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            page.wait_for_timeout(700)
        page.wait_for_timeout(6000)  # la cabaña (GLB) + textura + humo acumulándose
        page.wait_for_timeout(4000)  # margen extra de render bajo SwiftShader
        info = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : (window.__NS_DEBUG && window.__NS_DEBUG.baseCamp ? __NS_DEBUG.baseCamp() : null)")
        print("baseCamp:", info, flush=True)
        page.wait_for_timeout(3500)  # más humo acumulado
        page.screenshot(path="/home/z/my-project/download/T109-capturas/campamento-cabana-humo.png")
        page.wait_for_timeout(2500)  # segunda toma: el humo se movió
        page.screenshot(path="/home/z/my-project/download/T109-capturas/campamento-humo-2.png")
        print("capturas guardadas", flush=True)
        browser.close()
finally:
    srv.kill()
