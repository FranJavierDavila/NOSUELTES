#!/usr/bin/env python3
"""Sonda T122: rabietas (¿se disparan?) y comba del nudo (¿respeta el clamp?).
Carga ?nivel=pared, muestrea la sonda 40 s a 8 Hz y vuelca ventanas."""
import subprocess, time, urllib.request, json

BASE = "http://127.0.0.1:3100/NOSUELTES"

srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        page = browser.new_context(viewport={"width": 1280, "height": 720}).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        for _ in range(90):
            try:
                if page.evaluate("!!window.__PARED"): break
            except Exception: pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(2000)
        filas = []
        t0 = time.time()
        while time.time() - t0 < 40:
            s = page.evaluate("window.__PARED.sonda()")
            filas.append({"t": round(s["t"], 2), "rabieta": round(s["rabieta"], 3),
                          "nudoY": round(s["ricachon"]["nudoY"], 3) if s["ricachon"] else None,
                          "alt0": round(s["alt0"], 2), "alt1": round(s["alt1"], 2)})
            page.wait_for_timeout(125)
        pico = max(f["rabieta"] for f in filas)
        arranques = []
        prev = 0.0
        for f in filas:
            if f["rabieta"] > 0.05 and prev <= 0.05:
                arranques.append(f["t"])
            prev = f["rabieta"]
        print(f"rabieta pico={pico:.2f} arranques={arranques}")
        print(f"nudoY muestra a t=40: {filas[-1]['nudoY']} (alt0={filas[-1]['alt0']} alt1={filas[-1]['alt1']})")
        print(f"nudoY serie: {[f['nudoY'] for f in filas[::8]]}")
        print(f"errores JS: {errs[:3]}")
        browser.close()
finally:
    srv.kill()
