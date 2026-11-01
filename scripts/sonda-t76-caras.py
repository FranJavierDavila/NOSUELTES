#!/usr/bin/env python3
"""Sonda mínima T76: estado de ánimo/cara antes y después del pin.

Imprime, SIN capturas y en vivo (-u), el richMoodDebug completo y richFaces()
en cada paso para diagnosticar por qué el pin de ánimo no activa la cara.
"""
import json
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"


def sonda(page, tag):
    try:
        md = page.evaluate("__SHERPAS_DEBUG.richMood()")
    except Exception as e:
        md = f"ERR {e}"
    try:
        rf = page.evaluate("__SHERPAS_DEBUG.richFaces()")
    except Exception as e:
        rf = f"ERR {e}"
    print(f"[{tag}] richMood={json.dumps(md)} richFaces={json.dumps(rf)}", flush=True)


def recuperar(page) -> dict:
    t0 = time.time()
    rich = None
    while time.time() - t0 < 150:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
                page.wait_for_timeout(3000)
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
        except Exception:
            rich = None
            page.wait_for_timeout(3000)
            continue
        if rich and rich.get("pelvis"):
            break
        for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
            try:
                page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
            except Exception:
                pass
        page.wait_for_timeout(3000)
    if not rich or not rich.get("pelvis"):
        raise SystemExit("el ricachón nunca apareció")
    t0 = time.time()
    while time.time() - t0 < 90:
        try:
            faces = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if faces and faces.get("loaded") == 5:
                break
        except Exception:
            pass
        page.wait_for_timeout(3000)
    return rich


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.on("console", lambda m: errs.append(f"console: {m.text[:200]}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
    for _ in range(12):
        page.wait_for_timeout(4000)
        try:
            if page.evaluate("!!window.__SHERPAS_DEBUG"):
                break
        except Exception:
            pass
        try:
            page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b) b.click(); })()")
        except Exception:
            pass
    page.wait_for_timeout(2000)
    sonda(page, "inicio")
    rich = recuperar(page)
    sonda(page, "tras-recuperar")
    print("ret richMood('enfado') ->", page.evaluate("__SHERPAS_DEBUG.richMood('enfado')"), flush=True)
    page.wait_for_timeout(3000)
    sonda(page, "tras-pin")
    page.wait_for_timeout(5000)
    sonda(page, "tras-pin+5s")
    # sin pin: anular y volver a pinear por si el estado quedó raro
    print("ret richMood(null) ->", page.evaluate("__SHERPAS_DEBUG.richMood('')"), flush=True)
    page.wait_for_timeout(1500)
    sonda(page, "tras-unpin")
    print("ret richMood('enfado') ->", page.evaluate("__SHERPAS_DEBUG.richMood('enfado')"), flush=True)
    page.wait_for_timeout(3000)
    sonda(page, "tras-repin")
    print("pageerrors:", len(errs), errs[:5], flush=True)
    browser.close()
