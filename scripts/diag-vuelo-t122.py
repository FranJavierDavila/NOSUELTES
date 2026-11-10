#!/usr/bin/env python3
"""Diag T122 — vuelo balístico con traza: qué pasa clic a clic en el vuelo."""
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3199/NOSUELTES"


def start_server():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3199"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("no arrancó")


def sonda(page):
    try:
        return page.evaluate("window.__PARED && window.__PARED.sonda && window.__PARED.sonda()")
    except Exception:
        return None


srv = start_server()
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time()
        while time.time() - t0 < 90:
            if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(5000)

        # clic seco en la mochila (posición conocida del repro anterior)
        for x, y in [(546, 330)]:
            page.mouse.move(x, y)
            page.mouse.down()
            page.wait_for_timeout(25)
            page.mouse.up()
            s = sonda(page)
            print("clic mochila:", s.get("lanzamientos"), s.get("enVuelo"))

        # arrastre abajo
        page.mouse.move(546, 330)
        page.mouse.down()
        for dy in (30, 65, 100, 135, 170):
            page.mouse.move(546, 330 + dy)
            page.wait_for_timeout(40)
            if dy in (100, 170):
                s = sonda(page)
                print(f"  goma durante arrastre dy={dy}: gomaM={s.get('gomaM')} alt0={s.get('alt0'):.2f}")
        page.wait_for_timeout(60)
        page.mouse.up()
        s = sonda(page)
        print("soltar:", s.get("enVuelo"), s.get("lanzamientos"))

        # barrido con TRAZA
        for dy in range(0, -271, -30):
            for dx in (-55, 0, 55):
                page.mouse.move(546 + dx, 330 + dy)
                page.mouse.down()
                page.wait_for_timeout(22)
                page.mouse.up()
                s = sonda(page)
                if s.get("vueloObjetivo") or not any(s.get("enVuelo") or [False]):
                    print(f"clic({546+dx},{330+dy}): enVuelo={s.get('enVuelo')} obj={s.get('vueloObjetivo')} "
                          f"jug={s.get('vueloJugador')} mano={s.get('vueloMano')} state={s.get('state')} alt0={s.get('alt0'):.2f}")
                if not any(s.get("enVuelo") or [False]):
                    break
            if not any(s.get("enVuelo") or [False]):
                break
        page.wait_for_timeout(2000)
        s = sonda(page)
        print("final: state=%s alt0=%.2f alt1=%.2f" % (s.get("state"), s.get("alt0"), s.get("alt1")))
        print("errores JS:", errs[:3])
        browser.close()
finally:
    srv.kill()
