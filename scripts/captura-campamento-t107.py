#!/usr/bin/env python3
"""Capturas T107 — campamento tras eliminar las piedras procedurales sin
textura (screeRock*/fieldBoulder*). 4 vistas camPin + sonda de mallas:
ningún mesh llamado screeRock*/fieldBoulder* debe quedar; las losas GLB del
jugador (snowTiles) siguen en 112."""
import subprocess
import sys
import time

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/tmp/sonda-t107"


def probe(page, expr, tries=8, wait_ms=400):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(wait_ms)
    return None


def wait_el(page, sel, timeout_s=30):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate(f"!!document.querySelector('{sel}')"):
                return
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise TimeoutError(f"no apareció {sel}")


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


srv = start_servers()
import os
os.makedirs(OUT, exist_ok=True)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ])
        ctx = browser.new_context(viewport={"width": 1000, "height": 640})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE, wait_until="domcontentloaded")
        wait_el(page, "button[data-a=go]", timeout_s=120)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        page.click("button[data-a=go]")
        for _ in range(12):
            try:
                page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            page.wait_for_timeout(600)
        for _ in range(25):
            if probe(page, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.aim(0)", tries=1, wait_ms=0):
                break
            page.wait_for_timeout(900)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        page.wait_for_timeout(6000)  # asentar sombras/tiles

        stats = probe(page, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp && __SHERPAS_DEBUG.baseCamp()")
        meshes = probe(page, "(function(){var sc=window.__SHERPAS_DEBUG.sceneObj(); return sc && sc.meshes ? sc.meshes.map(function(m){return m.name;}).filter(function(n){return /screeRock|fieldBoulder|fieldCap/.test(n);}).length : null;})()")
        print(f"stats={stats}", flush=True)
        print(f"mallas piedra vieja (screeRock/fieldBoulder/fieldCap)={meshes}", flush=True)

        vistas = [
            ("general", 0.0, 5.4, -11.0, 12.5),
            ("cenital", 0.0, 16.0, -2.0, 3.0),
            ("pie-pared", -4.0, 1.4, -6.0, 8.5),
            ("primer-plano", 3.2, 0.9, -2.0, 3.4),
        ]
        for name, cx, cy, cz, dist in vistas:
            ok = probe(page, f"window.__SHERPAS_DEBUG.camPin({cx}, {cy}, {cz}, {dist})")
            page.wait_for_timeout(2600)
            page.screenshot(path=f"{OUT}/t107-{name}.png")
            print(f"  vista {name}: camPin={ok}", flush=True)
        print(f"errores JS: {errs[:3]}", flush=True)
        browser.close()
finally:
    srv.kill()
print("CAPTURAS T107 LISTAS")
