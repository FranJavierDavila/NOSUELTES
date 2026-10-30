#!/usr/bin/env python3
"""Diagnóstico E2E T57: qué pasa tras pulsar GO — estado del juego y sondas."""
import json
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)

    def ev(expr, label):
        try:
            r = page.evaluate(expr)
            print(f"  {label}: {repr(r)[:220]}")
            return r
        except Exception as e:
            print(f"  {label}: EXCEPCIÓN {type(e).__name__}: {str(e)[:150]}")
            return None

    ev("typeof window.__SHERPAS_DEBUG", "debug hook")
    ev("window.__SHERPAS_DEBUG && Object.keys(window.__SHERPAS_DEBUG).length", "nº sondas")

    # arrancar partida como la E2E
    page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
    page.click("text=SHERPAS AL LÍMITE", timeout=8000)
    page.wait_for_selector("button[data-a=go]", timeout=60000)
    page.click("button[data-a=go]")
    print("GO pulsado; esperando 10 s...")
    page.wait_for_timeout(10000)

    # canvas presente + HUD
    print("  canvas:", page.locator("canvas").count(), "| data-a:", page.locator("[data-a]").count())
    ev("window.__SHERPAS_DEBUG && Object.keys(window.__SHERPAS_DEBUG).join(',')", "sondas")
    # sondas SERIALIZABLES primero (partículas)
    ev("window.__SHERPAS_DEBUG && (window.__SHERPAS_DEBUG.particles ? window.__SHERPAS_DEBUG.particles(0).length : 'sin particles')", "particles(0)")
    ev("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.climber && __SHERPAS_DEBUG.climber()", "climber()")
    # sceneObj: probar serialización
    ev("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex", "sceneObj().strataTex (bool)")
    ev("(function(){try{var s=__SHERPAS_DEBUG.sceneObj();var o={};for(var k in s){try{o[k]=typeof s[k];}catch(e){}}return o;}catch(e){return 'ERR:'+e;}})()", "claves de sceneObj")
    ev("(function(){try{return JSON.parse(JSON.stringify(__SHERPAS_DEBUG.sceneObj().getPlantWindInfo ? __SHERPAS_DEBUG.sceneObj().getPlantWindInfo() : null));}catch(e){return 'ERR:'+e;}})()", "getPlantWindInfo JSON")
    print("  errores JS:", errors[:4])
    page.screenshot(path="/tmp/t57-diag.png")
    from PIL import Image
    img = Image.open("/tmp/t57-diag.png").convert("L")
    w, h = img.size
    c = img.crop((int(w*0.3), int(h*0.35), int(w*0.7), int(h*0.8)))
    print("  luma centro:", sum(c.getdata())/(c.width*c.height))
    browser.close()
