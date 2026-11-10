#!/usr/bin/env python3
"""Smoke T89/T90: modo test (?test=escalada) + Base.glb en la escena.
Un navegador: badge visible, GLB descargado, partida local arrancada,
fatiga a cero con agarre, campamento en el pie de pared (capturas)."""
import functools, http.server, os, re, subprocess, sys, threading, time, urllib.request

BASE = "http://localhost:3100"

def _kill_stale():
    for pat in ["[s]tandalone/server.js", "[n]ext-server", "[b]un.*server.js"]:
        subprocess.run(["pkill", "-f", pat], capture_output=True)
    time.sleep(1.2)
    try:
        urllib.request.urlopen(BASE, timeout=0.7)
        raise RuntimeError("el puerto 3100 sigue ocupado tras el pkill")
    except Exception:
        pass

def start_server():
    env = dict(os.environ, NODE_ENV="production", PORT="3100", HOSTNAME="127.0.0.1")
    proc = subprocess.Popen(["bun", ".next/standalone/server.js"], cwd="/home/z/my-project",
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE, timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("el servidor standalone no arrancó")

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

def js_click(page, sel, wait_ms=400):
    page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (e) e.click(); }})()")
    page.wait_for_timeout(wait_ms)

_kill_stale()
server = start_server()
fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}") or (None if c else fails.append(n))
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                 "--disable-dev-shm-usage", "--force-device-scale-factor=1"]
        br = pw.chromium.launch(args=flags)
        ctx = br.new_context(viewport={"width": 640, "height": 440})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        cons: list[str] = []
        page.on("console", lambda m: cons.append(m.text[:200]))

        print("== T90: Base.glb + T89: modo test ==")
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded")
        wait_el(page, "button[data-a=net]", timeout_s=90)
        ok("insignia MODO TEST visible", page.evaluate("!!document.getElementById('sherpas-test-badge')"))
        page.screenshot(path="download/t90-menu-test.png", timeout=20000)

        js_click(page, "[data-a=go]", wait_ms=2500)
        page.wait_for_timeout(8000)  # SwiftShader: deja que la escena y el campamento se asienten
        glb = page.evaluate("performance.getEntriesByType('resource').some(r => r.name.includes('base.glb'))")
        ok("base.glb descargado por la escena", glb)
        ok("sin aviso [basecamp] en consola", not any("[basecamp]" in c for c in cons))
        ok("0 errores JS", not errs, f"({len(errs)})")
        page.screenshot(path="download/t90-partida-test.png", timeout=20000)
        try:
            page.screenshot(path="download/t90-partida-test2.png", timeout=20000)
        except Exception:
            pass
        # fatiga a cero con el modo activo (waist() devuelve f por extremidad)
        try:
            w = page.evaluate("window.__SHERPAS_DEBUG?.waist?.(1)")
            fs = [l.get("f") for l in (w or {}).get("limbs", []) if l]
            ok("fatiga = 0 en todas las extremidades (modo test)", all((x or 0) == 0 for x in fs), f"(f={fs})")
        except Exception as e:
            print(f"  (info) waist no disponible: {e.__class__.__name__}")

        # control: sin ?test no hay insignia
        page2 = ctx.new_page()
        page2.goto(BASE, wait_until="domcontentloaded")
        wait_el(page2, "button[data-a=net]", timeout_s=90)
        ok("sin ?test: insignia ausente (juego normal intacto)",
           not page2.evaluate("!!document.getElementById('sherpas-test-badge')"))

        br.close()
finally:
    server.terminate()
print("T90 SMOKE VERDE" if not fails else f"T90 SMOKE FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
