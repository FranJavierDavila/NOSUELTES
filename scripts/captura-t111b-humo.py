#!/usr/bin/env python3
"""Captura T111b — el humo EN la boca y su columna (encuadre alto)."""
import subprocess
import sys
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T111-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3108/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3108"],
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
        page = browser.new_context(viewport={"width": 480, "height": 320}).new_page()
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
        for _ in range(25):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(1000)
        # encuadre ALTO: boca (5.1) + columna (hasta ~7.5) dentro del frame
        page.evaluate("__SHERPAS_DEBUG.camPin(4.43, 5.6, -1.87, 6.0)")
        page.wait_for_timeout(12000)
        page.screenshot(path=str(OUT / "t111-humo-columna.png"), timeout=120000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(OUT / "t111-humo-columna-2.png"), timeout=120000)
        # racha de viento: el humo debe doblarse en la dirección del viento
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('storm')")
        page.wait_for_timeout(5000)
        page.screenshot(path=str(OUT / "t111-humo-viento.png"), timeout=120000)
        print("capturas de humo listas")
        browser.close()
finally:
    srv.kill()
