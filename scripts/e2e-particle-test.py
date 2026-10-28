#!/usr/bin/env python3
"""Banco de pruebas de partículas: 3 variantes (alpha+standard, negro+ADD, negro+ADD+STRETCHED)."""
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 520, "height": 1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:8899/particle-test.html", wait_until="load")
    page.wait_for_timeout(2500)
    page.screenshot(path="/home/z/my-project/download/t30-particle-test.png", full_page=True)
    print("errores:", errors[:3])
    b.close()
