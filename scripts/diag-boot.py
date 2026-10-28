#!/usr/bin/env python3
"""Diagnóstico de arranque: consola + errores de página + HTML del menú."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("console", lambda m: print(f"[console:{m.type}] {m.text[:200]}"))
    page.on("pageerror", lambda e: print(f"[PAGEERROR] {str(e)[:400]}"))
    page.on("requestfailed", lambda r: print(f"[REQFAIL] {r.url[-90:]} {r.failure}"))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(2500)
    print("TITLE:", page.title())
    html = page.content()
    print("has SHERPAS:", "SHERPAS" in html.upper())
    print("body len:", len(html))
    browser.close()
