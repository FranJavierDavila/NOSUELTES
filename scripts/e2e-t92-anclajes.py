#!/usr/bin/env python3
"""T92 E2E: anclajes portátiles (10/escalador, tecla T) + ruta siempre posible.
Sondas: __SHERPAS_DEBUG.portables() / holds() / setAim + tecla KeyT real."""
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

        print("== T92: anclajes portátiles ==")
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded")
        wait_el(page, "button[data-a=net]", timeout_s=90)
        js_click(page, "[data-a=go]", wait_ms=2500)
        # espera a que el match exista y la pared tenga presas
        port = None
        for _ in range(40):
            page.wait_for_timeout(500)
            port = page.evaluate("window.__SHERPAS_DEBUG?.portables?.()")
            if port and port["left"] == [10, 10]:
                break
        ok("inventario inicial 10/10 (petición: cada uno 10)", bool(port) and port["left"] == [10, 10],
           f"({port})")

        # suelta la mano izquierda de P1 (Digit1) para poder alcanzar a colocar
        page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }))")
        page.wait_for_timeout(400)
        # apunta JUSTO sobre la presa de la mano (start_hl en (-0.55, 3.8)):
        # la punta de la mano está EN el plano de pared → factible directo.
        page.evaluate("window.__SHERPAS_DEBUG.setAim(-0.55, 4.2)")
        page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }))")
        page.wait_for_timeout(600)
        port2 = page.evaluate("window.__SHERPAS_DEBUG.portables()")
        ok("anclaje colocado con T (inventario 9)", bool(port2) and len(port2["placed"]) == 1 and port2["left"][0] == 9,
           f"({port2})")
        hold_ids = page.evaluate("window.__SHERPAS_DEBUG.holds().map(h => h.id).filter(id => id.startsWith('pa'))")
        ok("el anclaje es UNA PRESA real del sistema (agarrable)", len(hold_ids) >= 1, f"({hold_ids})")

        # segundo: suelta la mano derecha (Digit2) — la izquierda fue capturada
        # por el IMÁN del anclaje recién colocado (comportamiento del juego) —
        # y apunta MUY lejos (fuera de alcance) → proyección factible.
        page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }))")
        page.wait_for_timeout(400)
        page.evaluate("window.__SHERPAS_DEBUG.setAim(2.2, 8.5)")
        page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }))")
        page.wait_for_timeout(600)
        port3 = page.evaluate("window.__SHERPAS_DEBUG.portables()")
        ok("aim fuera de alcance → colocación factible proyectada (inventario 8)",
           bool(port3) and len(port3["placed"]) == 2 and port3["left"][0] == 8, f"({port3})")

        # el chip de carga muestra los portátiles
        share_txt = page.evaluate("document.querySelector('[data-e=share]')?.textContent || ''")
        ok("HUD muestra el inventario (⚓ 8/10)", "8" in share_txt and "10" in share_txt, f"({share_txt[:60]})")

        # captura: cámara sobre el primer anclaje colocado
        ax = port3["placed"][0]["x"]; ay = port3["placed"][0]["y"]
        page.evaluate(f"window.__SHERPAS_DEBUG?.camPin?.({ax}, {ay}, -0.64, 3.2)")
        page.wait_for_timeout(3500)
        page.screenshot(path="download/t92-anclaje.png", timeout=45000)

        # inventario de P2 intacto
        ok("P2 conserva sus 10", port3["left"][1] == 10, f"({port3['left']})")
        ok("0 errores JS", not errs, f"({len(errs)})" if errs else "")
        br.close()
finally:
    server.terminate()
print("T92 VERDE" if not fails else f"T92 FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
