#!/usr/bin/env python3
"""T100 — captura del menú CARRY ME EN PRODUCCIÓN (GitHub Pages)."""
from playwright.sync_api import sync_playwright

URL = "https://franjavierdavila.github.io/NOSUELTES/"
with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 1280, "height": 800})
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_function(
        "()=>!!document.querySelector('.start-hero') && document.querySelector('.hero-art')?.naturalWidth>0",
        timeout=45000)
    page.wait_for_timeout(2000)
    txt = page.evaluate("()=>document.querySelector('.start-hero')?.textContent ?? ''")
    botones = page.eval_on_selector_all("[data-e=start] button", "els=>els.map(e=>e.dataset.a||'?')")
    tab = page.title()
    page.screenshot(path="/home/z/my-project/download/t100-produccion.png")
    b.close()

print("pestaña:", tab)
print("botones:", botones)
print("EN por defecto:", "How to play?" in txt and "Play online" in txt)
print("errores JS:", errs if errs else "ninguno")
assert "How to play?" in txt and "Play online" in txt and botones == ["settings", "go", "howto", "net"]
assert tab == "CARRY ME" and not errs
print("PRODUCCIÓN VERDE")
