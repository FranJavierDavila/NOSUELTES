#!/usr/bin/env python3
"""Debug: consola + errores + screenshot del estado actual."""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    msgs, errs = [], []
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text[:200]}"))
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))
    page.goto("http://localhost:3000", wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    time.sleep(8)
    print("ERRORES:", errs[:5] or "ninguno")
    print("CONSOLA:", [m for m in msgs if m.startswith("error") or m.startswith("warning")][:8] or "limpia")
    page.screenshot(path="/home/z/my-project/download/perf-debug.png")
    print("captura ok")
    browser.close()
