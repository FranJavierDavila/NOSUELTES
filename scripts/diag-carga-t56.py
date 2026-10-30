#!/usr/bin/env python3
"""Diagnóstico 2: click en SHERPAS y ver qué explota al montar el juego."""
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    logs = []
    page.on("console", lambda m: logs.append(f"[{m.type}] {m.text[:400]}"))
    page.on("pageerror", lambda e: logs.append(f"[PAGEERROR] {str(e)[:800]}"))
    page.goto("http://localhost:3000", wait_until="domcontentloaded")
    page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_timeout(25000)
    body = page.evaluate("document.body.innerText.slice(0, 700)")
    print("BODY:", body.replace("\n", " | ")[:700])
    print("---- LOGS ----")
    for l in logs[:60]:
        print(l)
    page.screenshot(path="/tmp/diag-juego.png")
    browser.close()
print("DIAG2 LISTO")
