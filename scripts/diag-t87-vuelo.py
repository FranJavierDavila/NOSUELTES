#!/usr/bin/env python3
"""Diagnóstico T87 — traza Densa del vuelo de la mochila: (t, alt, enVuelo,
anclajes, ropeState) cada 50 ms desde el lanzamiento. Sirve para ver DÓNDE
muere la velocidad vertical del vuelo diagonal."""
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


def sonda(page):
    return page.evaluate("window.__PARED.sonda()")


def espera(page, cond, segs, paso=200, etiqueta=""):
    t0 = time.time()
    while time.time() - t0 < segs:
        try:
            s = sonda(page)
            if cond(s):
                return s
        except Exception:
            pass
        page.wait_for_timeout(paso)
    print(f"[espera {etiqueta}] agotó", flush=True)
    return None


srv = start_servers()
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
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        if not espera(page, lambda s: s["bloques"] > 0 and s["anclajes"][0] >= 4, 140, paso=400, etiqueta="arranque"):
            print("FALLO arranque", flush=True)
            sys.exit(1)
        page.wait_for_timeout(3000)

        m = sonda(page)["mochilaPx"]
        pi = m["pi"]
        page.mouse.click(m["x"], m["y"])
        page.wait_for_timeout(500)
        if sonda(page)["mochilaAbierta"] != pi:
            print("FALLO: interior no abrió", flush=True)
            sys.exit(1)
        page.locator("#pared-mochila-win > div").nth(2).click()
        page.wait_for_timeout(300)

        m = sonda(page)["mochilaPx"]
        x0, y0 = m["x"], m["y"]
        page.mouse.move(x0, y0)
        page.mouse.down()
        goma = 0.0
        for i in range(1, 60):
            page.mouse.move(x0 + 9 * i, y0 + 13 * i, steps=2)
            page.wait_for_timeout(50)
            goma = sonda(page)["gomaM"] or 0.0
            if goma >= 1.35:  # ~85% del recorrido 1.6 m
                break
        fl = sonda(page)["gomaFlecha"]
        print(f"LANZANDO: gomaM={goma:.2f} frac={fl['frac']:.2f} ang={fl['ang']:.2f}", flush=True)
        t0 = time.time()
        page.mouse.up()
        prev_alt = None
        for _ in range(90):
            s = sonda(page)
            alt = s["alt0"] if pi == 0 else s["alt1"]
            x = s["x0"] if pi == 0 else s["x1"]
            vy = "" if prev_alt is None else f" vy={(alt - prev_alt) * 20:+.2f}"
            prev_alt = alt
            print(f"t={time.time() - t0:5.2f}s alt={alt:+.3f} x={x:+.3f} vuelo={int(s['enVuelo'][pi])} anc={s['anclajes'][pi]} rope={s['ropeStates'][pi]:8s}{vy}", flush=True)
            if not s["enVuelo"][pi] and time.time() - t0 > 2.5:
                break
            page.wait_for_timeout(50)
        print(f"ESTADO final: {sonda(page)['state']}", flush=True)
        browser.close()
finally:
    srv.kill()
