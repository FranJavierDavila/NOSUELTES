#!/usr/bin/env python3
"""T115b — capturas visuales EN PARTIDA: (1) chimenea con el humo saliendo del
tubo, (2) vista estilo captura 2 del jugador (canto derecho, sin losa vertical)."""
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path("/home/z/my-project/download/T115-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3121/NOSUELTES"

srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3121"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
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
            "--js-flags=--max-old-space-size=420",
        ])
        ctx = browser.new_context(viewport={"width": 900, "height": 600})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        for _ in range(60):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(80):
            try:
                if page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(3000)
        # (1) la chimenea de frente: humo naciendo EN el tubo
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(4.7, 2.4, -1.0, 7)")
        page.wait_for_timeout(2500)
        try:
            page.screenshot(path=str(OUT / "06-partida-chimenea.png"), timeout=20000)
            print("✓ 06-partida-chimenea.png", flush=True)
        except Exception as e:
            print("✗ shot1", str(e)[:80], flush=True)
        # (2) vista del jugador (captura 2): cerca de la cabaña mirando al canto derecho
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(2.4, 3.2, -7.5, 8)")
        page.wait_for_timeout(2200)
        try:
            page.screenshot(path=str(OUT / "07-canto-derecho.png"), timeout=20000)
            print("✓ 07-canto-derecho.png", flush=True)
        except Exception as e:
            print("✗ shot2", str(e)[:80], flush=True)
        # (3) junta ala-muro (costuras)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(6.6, 2.0, -4.5, 5)")
        page.wait_for_timeout(2200)
        try:
            page.screenshot(path=str(OUT / "08-junta-ala-muro.png"), timeout=20000)
            print("✓ 08-junta-ala-muro.png", flush=True)
        except Exception as e:
            print("✗ shot3", str(e)[:80], flush=True)
        browser.close()
finally:
    srv.terminate()
print("fin")
