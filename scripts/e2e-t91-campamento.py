#!/usr/bin/env python3
"""T91: el campamento Base.glb DEBE verse. camPin sobre (7.9,-5.2) + captura
fijada + vista de aparición (spawn) + sonda baseCamp + 0 errores JS."""
import os, subprocess, sys, time, urllib.request

BASE = "http://localhost:3100"

def _kill_stale():
    for pat in ["[s]tandalone/server.js", "[n]ext-server", "[b]un.*server.js"]:
        subprocess.run(["pkill", "-f", pat], capture_output=True)
    time.sleep(1.2)

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

def wait_el(page, sel, timeout_s=40):
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

        print("== T91: campamento VISIBLE ==")
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded")
        wait_el(page, "button[data-a=net]", timeout_s=90)
        js_click(page, "[data-a=go]", wait_ms=2500)
        # sondeo: el parse del GLB tarda ~8 s en SwiftShader
        pieces = 0
        for _ in range(12):
            page.wait_for_timeout(2000)
            pieces = (page.evaluate("window.__SHERPAS_DEBUG?.baseCamp?.()") or {}).get("cabinPieces", 0)
            if pieces >= 1:
                break
        ok("GLB cargado (cabinPieces ≥ 1)", pieces >= 1, f"(cabinPieces={pieces})")
        ok("sin aviso [basecamp] en consola", not any("[basecamp]" in c for c in cons))
        ok("0 errores JS", not errs, f"({len(errs)})" if errs else "")

        # captura de la vista de aparición (lo que ve el jugador al empezar)
        page.screenshot(path="download/t91-spawn.png", timeout=45000)

        # cámara fijada sobre el campamento, a 10 m
        pin = page.evaluate("window.__SHERPAS_DEBUG?.camPin?.(7.9, 2.2, -5.2, 10)")
        ok("camPin aceptado", pin is True)
        page.wait_for_timeout(3500)  # deja que la cámara llegue y renderice
        page.screenshot(path="download/t91-campamento-pin.png", timeout=45000)
        # segundo ángulo: más alto y más lejos
        page.evaluate("window.__SHERPAS_DEBUG?.camPin?.(7.9, 4.5, -5.2, 16)")
        page.wait_for_timeout(2500)
        page.screenshot(path="download/t91-campamento-lejos.png", timeout=45000)
        br.close()
finally:
    server.terminate()
print("T91 VERDE" if not fails else f"T91 FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
