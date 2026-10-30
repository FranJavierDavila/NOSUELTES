#!/usr/bin/env python3
"""E2E T60 — JUEGO REMOTO: el sherpa AZUL conecta desde otro navegador.
(1) El HOST crea sala por el panel 🌐 (código de 4 caracteres).
(2) El GUEST se une con el código (socket.io por el gateway XTransformPort).
(3) El host pulsa GO → el guest recibe la sesión (2 semillas), construye la
    MISMA pared y empieza a renderizar snapshots.
(4) Sincronía: cinturas A/B del guest ≈ cinturas del host (escena estática).
(5) INPUT REMOTO: el guest mantiene ArrowRight → el aim del P2 del host se
    mueve (camino completo guest→servicio→mixer→rig).
(6) HUD del snapshot y 0 errores JS en ambos extremos. Capturas con luma."""
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image as _Img

BASE = "http://localhost:81"  # gateway Caddy: página + XTransformPort → :3003
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def probe(page, expr, tries=8, wait_ms=400):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(wait_ms)
    return None


def luma_shot(page, path, x0=0.30, x1=0.70, y0=0.35, y1=0.80):
    page.screenshot(path=path)
    img = _Img.open(path).convert("L")
    w, h = img.size
    c = img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
    stat = sum(c.getdata()) / (c.width * c.height)
    print(f"  luma centro {stat:.0f} -> {path.split('/')[-1]}")
    return stat


def menu(page):
    """Landing 'ELIGE TU ASCENSO' → tarjeta de SHERPAS → menú del juego."""
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    try:
        page.click("text=SHERPAS AL LÍMITE", timeout=20000)
    except Exception:
        pass  # ya estábamos dentro (el clic no navega en sesión previa)
    page.wait_for_selector("button[data-a=net]", timeout=90000)


with sync_playwright() as pw:
    # DOS NAVEGADORES (como dos máquinas): con dos pestañas en un mismo
    # navegador, la de fondo ve su rAF pausado y sus timers a 1/s — la sim del
    # host se paraba y el input del guest llegaba a cuentagotos. Cada navegador
    # aparte tiene SU página en primer plano (viewport pequeño por la RAM).
    flags = [
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--js-flags=--max-old-space-size=300",
    ]
    browser_h = pw.chromium.launch(args=flags)
    browser_g = pw.chromium.launch(args=flags)
    ctx_h = browser_h.new_context(viewport={"width": 560, "height": 400})
    ctx_h.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    host = ctx_h.new_page()
    err_h = []
    host.on("pageerror", lambda e: err_h.append(str(e)))

    print("== HOST: crea la sala ==")
    menu(host)
    host.click("button[data-a=net]")
    host.wait_for_selector("[data-a=netHost]", timeout=10000)
    host.click("[data-a=netHost]")
    code = None
    t0 = time.time()
    while time.time() - t0 < 15:
        try:
            code = host.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
        except Exception:
            code = None
        if code:
            break
        host.wait_for_timeout(400)
    check("código de sala recibido", bool(code and len(code) == 4), f"(código={code!r})")
    code = code or "AAAA"

    print("== GUEST: se une con el código ==")
    ctx_g = browser_g.new_context(viewport={"width": 560, "height": 400})
    ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    guest = ctx_g.new_page()
    err_g = []
    guest.on("pageerror", lambda e: err_g.append(str(e)))
    menu(guest)
    guest.click("button[data-a=net]")
    guest.wait_for_selector("[data-a=netCode]", timeout=10000)
    guest.fill("[data-a=netCode]", code)
    guest.click("[data-a=netJoin]")
    ok_join = False
    t0 = time.time()
    while time.time() - t0 < 15:
        st = probe(guest, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()", tries=1, wait_ms=0) or ""
        if "Esperando a que el anfitri" in st:
            ok_join = True
            break
        guest.wait_for_timeout(400)
    check("guest unido y esperando sesión", ok_join)
    ok_host_sees = False
    t0 = time.time()
    while time.time() - t0 < 10:
        st = probe(host, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()", tries=1, wait_ms=0) or ""
        if "conectado" in st.lower():
            ok_host_sees = True
            break
        host.wait_for_timeout(400)
    check("host ve al compañero conectado", ok_host_sees)

    print("== HOST pulsa GO; el guest construye la pared y recibe snapshots ==")
    host.click("button[data-a=netBack]")
    host.wait_for_timeout(400)
    host.click("button[data-a=go]")

    # partida real en el host (drag no null = match, no preview)
    ok_match = False
    t0 = time.time()
    while time.time() - t0 < 120:
        try:
            d = host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0)")
            if d is not None:
                ok_match = True
                break
        except Exception:
            pass
        host.wait_for_timeout(1500)
    check("partida del host arrancada", ok_match)
    host.wait_for_timeout(6000)  # warm-up de escena

    # el guest monta su mundo (escena nueva + runner)
    ok_guest = False
    t0 = time.time()
    while time.time() - t0 < 90:
        try:
            g = guest.evaluate("window.__NS_GUEST && __NS_GUEST()")
            if g and g.get("size", 0) >= 2:
                ok_guest = True
                break
        except Exception:
            pass
        guest.wait_for_timeout(1200)
    check("guest renderizando snapshots", ok_guest)

    print("== SINCRONÍA de posiciones (escena en reposo) ==")
    def as_xyz(v):
        if isinstance(v, dict):
            return [v.get("x", 0), v.get("y", 0), v.get("z", 0)]
        return list(v)[:3] if isinstance(v, (list, tuple)) else [0, 0, 0]
    hw = as_xyz(probe(host, "__SHERPAS_DEBUG.waist(0)") or [0, 0, 0])
    hw1 = as_xyz(probe(host, "__SHERPAS_DEBUG.waist(1)") or [0, 0, 0])
    gw = probe(guest, "window.__NS_GUEST && __NS_GUEST()") or {}
    gwa = as_xyz(gw.get("wa") or [9, 9, 9])
    gwb = as_xyz(gw.get("wb") or [9, 9, 9])
    d0 = max(abs(hw[i] - gwa[i]) for i in range(3))
    d1 = max(abs(hw1[i] - gwb[i]) for i in range(3))
    check("cintura A host≈guest (<0.4 m)", d0 < 0.4, f"(d={d0:.3f})")
    check("cintura B host≈guest (<0.4 m)", d1 < 0.4, f"(d={d1:.3f})")
    check("HUD viaja en el snapshot", bool(gw.get("hud")))
    luma_shot(guest, f"{OUT}/t60-0-guest-partida.png")
    luma_shot(host, f"{OUT}/t60-1-host-partida.png")

    print("== INPUT REMOTO: flecha izquierda del guest mueve el aim de P2 en el host ==")
    # IZQUIERDA: B arranca en el lado derecho de la pared y el aim se acota en
    # coords absolutas (±ancho/2−0.2) — hacia el centro hay ~2 m de recorrido.
    # CONGELAMOS el render del guest durante la pulsación: SwiftShader satura
    # su hilo y estrangula el emisor a ~1/s; sin pintar, envía a 33 ms. El host
    # aplica a su fps de software (~3/s): 6 s ≈ 0,5 m de desplazamiento.
    n0 = probe(host, "__SHERPAS_DEBUG.net()") or {}
    aim0 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
    guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(true)")
    guest.keyboard.down("ArrowLeft")
    guest.wait_for_timeout(6000)
    guest.keyboard.up("ArrowLeft")
    guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(false)")
    guest.wait_for_timeout(800)
    n1 = probe(host, "__SHERPAS_DEBUG.net()") or {}
    aim1 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
    print(f"  net host: {n0} -> {n1}")
    g2 = probe(guest, "window.__NS_GUEST && __NS_GUEST()") or {}
    print(f"  guest runner: sent={g2.get('sent')} got={g2.get('got')}")
    dx = (aim0.get("x") or 0) - (aim1.get("x") or 0)  # hacia la izquierda = x baja
    check("aim de P2 se movió con teclado del guest (>0.25 m)", dx > 0.25, f"(dx={dx:.3f})")
    luma_shot(guest, f"{OUT}/t60-2-guest-tras-input.png")

    check("0 errores JS en el host", len(err_h) == 0, f"({len(err_h)}{': ' + err_h[0][:100] if err_h else ''})")
    check("0 errores JS en el guest", len(err_g) == 0, f"({len(err_g)}{': ' + err_g[0][:100] if err_g else ''})")
    browser_h.close()
    browser_g.close()

print()
if FALLOS:
    print(f"E2E T60 FALLÓ: {len(FALLOS)} -> {FALLOS}")
    sys.exit(1)
print("E2E T60 VERDE: juego remoto OK (sala, sesión, snapshots, input remoto).")
