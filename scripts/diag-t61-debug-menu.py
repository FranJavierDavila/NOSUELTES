#!/usr/bin/env python3
"""Depuración: por qué no arranca la partida tras GO."""
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors, console = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:200]}"))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(15000)
    print("TITLE:", page.title())
    html = page.evaluate("document.body.innerHTML.length")
    print("body len:", html)
    botones = page.evaluate("Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim().slice(0,30)+'|'+(b.offsetParent?'vis':'hid'))")
    print("BOTONES:", botones[:20])
    ov = page.evaluate("Array.from(document.querySelectorAll('[data-e]')).map(e=>e.getAttribute('data-e')+(e.classList.contains('hidden')?':hidden':':VIS'))")
    print("OVERLAYS:", ov)
    try:
        page.click("text=SHERPAS AL LÍMITE", timeout=8000)
    except Exception as e:
        print("click titulo:", e.__class__.__name__)
    page.wait_for_timeout(3000)
    try:
        page.wait_for_selector("button[data-a=go]", timeout=60000)
        print("GO visible")
        page.click("button[data-a=go]")
    except Exception as e:
        print("GO:", e.__class__.__name__)
    page.wait_for_timeout(6000)
    botones = page.evaluate("Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim().slice(0,30)+'|'+(b.offsetParent?'vis':'hid'))")
    print("BOTONES tras GO:", botones[:20])
    print("PAGEERRORS:", len(errors), errors[:5])
    for c in console[-15:]:
        print("CONSOLE", c)
    browser.close()
