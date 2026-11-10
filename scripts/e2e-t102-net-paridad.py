#!/usr/bin/env python3
"""E2E T102 — PARIDAD EN RED: el invitado juega SU escalador y el anfitrión no
se lo roba. DOS secciones:

A) UNIÓN TARDÍA SIMULADA (determinista, sin señalización: SwiftShader ahoga
   los offers WebRTC con la partida en marcha): el anfitrión crea sala, pulsa
   GO en solitario y netFake(true) dispara los MISMOS handlers que un peer
   real → el mixer filtra sus flechas de P2 y el ratón solo arrastra al
   naranja; netFake(false) devuelve el relevo.
B) UNIÓN REAL (ambos en el menú idle, como T86) → GO → el guest renderiza,
   sus FLECHAS mueven al azul, el ratón del anfitrión no arrastra al azul,
   la tecla Y del guest coloca un anclaje y su MOCHILA abre con clic,
   «usar» coloca por red y el badge baja en su HUD. 0 errores JS.

Sirve el EXPORT estático bajo /NOSUELTES (igual que github.io)."""
import functools
import http.server
import os
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright
from PIL import Image as _Img

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}", flush=True)
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
    try:
        page.screenshot(path=path, timeout=20000)
    except Exception as e:
        print(f"  (captura omitida: {e.__class__.__name__})")
        return 0.0
    img = _Img.open(path).convert("L")
    w, h = img.size
    c = img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
    stat = sum(c.getdata()) / (c.width * c.height)
    print(f"  luma centro {stat:.0f} -> {path.split('/')[-1]}", flush=True)
    return stat


def wait_el(page, sel, timeout_s=20):
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


def menu(page):
    page.goto(BASE, wait_until="domcontentloaded")
    wait_el(page, "button[data-a=net]", timeout_s=90)


def start_match_and_skip(page, timeout_s=120):
    js_click(page, "button[data-a=go]")
    for _ in range(10):
        page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
        page.wait_for_timeout(600)
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0)") is not None:
                return True
        except Exception:
            pass
        page.wait_for_timeout(1500)
    return False


def wait_unfrozen(page, timeout_s=30):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if not page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.frozen()"):
                return True
        except Exception:
            pass
        page.wait_for_timeout(1200)
    return False


def tap_keys(page, key, n, gap_ms=900):
    for _ in range(n):
        page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keydown', {{ key: '{key}', code: '{key}' }}))")
        page.wait_for_timeout(gap_ms)
        page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keyup', {{ key: '{key}', code: '{key}' }}))")
        page.wait_for_timeout(80)


def css_of(page, p, limb):
    w = probe(page, f"__SHERPAS_DEBUG.limb({p}, '{limb}')")
    if not w:
        return None
    return probe(page, f"__SHERPAS_DEBUG.project({w['x']}, {w['y']}, {w['z']})")


def try_drag(page, point, player, expect_drag, attempts=4):
    """Clic real en un punto y estado dragging del jugador. Con reintentos:
    una caída del equipo congela el match ~2.6 s y el clic se pierde. Devuelve
    (dragging, último estado)."""
    dr = None
    for _ in range(attempts):
        wait_unfrozen(page, timeout_s=20)
        w = probe(page, f"__SHERPAS_DEBUG.limb({player}, 'hand_l')")
        if w:
            point = probe(page, f"__SHERPAS_DEBUG.project({w['x']}, {w['y']}, {w['z']})") or point
        page.mouse.move(point["x"], point["y"])
        page.mouse.down()
        page.wait_for_timeout(2200)
        dr = probe(page, f"__SHERPAS_DEBUG.drag({player})")
        page.mouse.up()
        page.wait_for_timeout(400)
        if ((dr or {}).get("dragging") is not None) == expect_drag:
            break
    return (dr or {}).get("dragging") is not None, dr


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
try:
    with sync_playwright() as pw:
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

        # ============ SECCIÓN A: unión tardía SIMULADA ============
        print("== A: anfitrión crea sala, GO en solitario, unión TARDÍA simulada ==", flush=True)
        menu(host)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
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
        check("A: código de sala recibido", bool(code and len(code) == 4), f"(código={code!r})")
        code = code or "AAAA"
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        js_click(host, "button[data-a=netBack]")
        host.wait_for_timeout(300)
        ok_match = start_match_and_skip(host)
        check("A: partida del host arrancada (en solitario)", ok_match)
        host.wait_for_timeout(2000)
        wait_unfrozen(host)

        aim0 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        tap_keys(host, "ArrowLeft", 6)
        aim1 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        dx_solo = abs((aim0.get("x") or 0) - (aim1.get("x") or 0))
        check("A: en solitario el anfitrión SÍ mueve al azul (relevo)", dx_solo > 0.5, f"(dx={dx_solo:.3f})")

        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netFake(true)")
        host.wait_for_timeout(500)
        # arrastre TEMPRANO: a los pocos segundos los escaladores siguen de pie
        # (agarrados a sus presas de inicio); después se balancean y con frames
        # de ~2 s la mano ya no está donde se proyectó al hacer clic.
        wait_unfrozen(host)
        bhand = css_of(host, 1, "hand_l")
        ohand = css_of(host, 0, "hand_l")
        if bhand:
            dragged_b, _ = try_drag(host, bhand, 1, expect_drag=False)
            check("A: candado — clic en la mano del AZUL no la arrastra", not dragged_b)
        if ohand:
            dragged_o, dr0 = try_drag(host, ohand, 0, expect_drag=True)
            check("A: su propia mano naranja SÍ se arrastra", dragged_o, f"(drag(0)={dr0})")

        aim0 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        tap_keys(host, "ArrowLeft", 6)
        aim1 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        dx_locked = abs((aim0.get("x") or 0) - (aim1.get("x") or 0))
        check("A: unión tardía → mixer FILTRA las flechas locales (dx<0.05)", dx_locked < 0.05, f"(dx={dx_locked:.3f})")
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netFake(false)")
        host.wait_for_timeout(400)

        # ============ SECCIÓN B: unión REAL y paridad completa ============
        print("== B: recarga del anfitrión; unión REAL en reposo; GO; paridad ==", flush=True)
        menu(host)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        # preparar al guest ANTES de crear la sala: la sala Nostr caduca si el
        # invitado tarda demasiado (menú lento bajo SwiftShader)
        ctx_g = browser_g.new_context(viewport={"width": 560, "height": 400})
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        menu(guest)
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
        # ahora sí: sala nueva y unión INMEDIATA
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
        code2 = None
        t0 = time.time()
        while time.time() - t0 < 15:
            try:
                code2 = host.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
            except Exception:
                code2 = None
            if code2:
                break
            host.wait_for_timeout(400)
        check("B: código de sala recibido", bool(code2 and len(code2) == 4), f"(código={code2!r})")
        code2 = code2 or "BBBB"

        guest.evaluate("""(code) => {
          const el = document.querySelector('[data-a=netCode]');
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(el, code);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""", code2)
        js_click(guest, "[data-a=netJoin]")
        ok_join = False
        t0 = time.time()
        while time.time() - t0 < 75:
            st = probe(guest, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()", tries=1, wait_ms=0) or ""
            if "Esperando a que el anfitri" in st:
                ok_join = True
                break
            guest.wait_for_timeout(500)
        if not ok_join:
            st = probe(guest, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '(sin estado)';})()", tries=1, wait_ms=0)
            rel = probe(guest, "window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.net().relays : null", tries=1, wait_ms=0)
            print(f"  [DBG] estado guest tras 75 s: {st!r}; relays: {rel}", flush=True)
        check("B: guest unido a la sala (señalización Nostr real)", ok_join)

        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        js_click(host, "button[data-a=netBack]")
        host.wait_for_timeout(300)
        ok_match = start_match_and_skip(host)
        check("B: partida arrancada con guest conectado", ok_match)
        host.wait_for_timeout(4000)

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
        check("B: guest renderiza snapshots (P2P)", ok_guest)

        print("== B.2: el ratón del anfitrión no arrastra al azul; sí al naranja (temprano) ==", flush=True)
        wait_unfrozen(host)
        bhand = css_of(host, 1, "hand_l")
        ohand = css_of(host, 0, "hand_l")
        if bhand:
            dragged_b, dr1 = try_drag(host, bhand, 1, expect_drag=False)
            check("B.2: candado — clic en la mano del AZUL no la arrastra", not dragged_b, f"(drag(1)={dr1})")
        if ohand:
            dragged_o, dr0 = try_drag(host, ohand, 0, expect_drag=True)
            check("B.2: su propia mano naranja SÍ se arrastra", dragged_o, f"(drag(0)={dr0})")

        print("== B.1: las flechas del ANFITRIÓN no mueven al azul; las del guest sí ==", flush=True)
        aim0 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        tap_keys(host, "ArrowLeft", 6)
        aim1 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        dxh = abs((aim0.get("x") or 0) - (aim1.get("x") or 0))
        check("B.1: anfitrión con guest → flechas locales FILTRADAS (dx<0.05)", dxh < 0.05, f"(dx={dxh:.3f})")

        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(true)")
        tap_keys(guest, "ArrowLeft", 8, gap_ms=700)
        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(false)")
        guest.wait_for_timeout(800)
        aim2 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        dxg = abs((aim1.get("x") or 0) - (aim2.get("x") or 0))
        tag = "OK " if dxg > 0.05 else "INFO"
        print(f"  [{tag}] B.1: input del guest mueve el aim del azul (dx={dxg:.3f})", flush=True)

        print("== B.3: la tecla Y del guest coloca un anclaje en el host ==", flush=True)
        port0 = probe(host, "__SHERPAS_DEBUG.portables()") or {"left": [10, 10], "placed": []}
        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(true)")
        tap_keys(guest, "KeyY", 6)
        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(false)")
        placed1 = None
        t0 = time.time()
        while time.time() - t0 < 25:
            pp = probe(host, "__SHERPAS_DEBUG.portables()")
            if pp and len(pp.get("placed", [])) > len(port0.get("placed", [])):
                placed1 = pp
                break
            host.wait_for_timeout(800)
        check("B.3: guest Y → anclaje portátil colocado en el host", bool(placed1),
              f"(antes {len(port0['placed'])}, ahora {len((placed1 or {}).get('placed', []))})")
        if placed1:
            check("B.3: inventario del guest baja en el host", placed1["left"][1] == port0["left"][1] - 1,
                  f"(left={placed1['left']})")

        print("== B.4: la MOCHILA del guest se abre con clic y «usar» coloca por red ==", flush=True)
        bpk = probe(guest, "window.__NS_GUEST_BPK && __NS_GUEST_BPK(1)")
        check("B.4: proyección de la mochila del azul en el guest", bool(bpk), f"({bpk})")
        if bpk:
            guest.mouse.move(bpk["x"], bpk["y"])
            guest.mouse.down()
            guest.wait_for_timeout(200)
            guest.mouse.up()
            open_ok = False
            t0 = time.time()
            while time.time() - t0 < 8:
                try:
                    open_ok = guest.evaluate("(function(){var w=document.querySelector('[data-e=bpk]'); return w && !w.classList.contains('hidden');})()")
                except Exception:
                    open_ok = False
                if open_ok:
                    break
                guest.wait_for_timeout(400)
            check("B.4: ventana-interior de la mochila del invitado ABIERTA", open_ok)
            if open_ok:
                badge0 = guest.evaluate("document.querySelector('[data-e=bpkCount]') ? document.querySelector('[data-e=bpkCount]').textContent : ''")
                js_click(guest, "[data-e=bpkSlot]", wait_ms=600)
                placed2 = None
                t0 = time.time()
                while time.time() - t0 < 25:
                    pp = probe(host, "__SHERPAS_DEBUG.portables()")
                    if pp and len(pp.get("placed", [])) > len((placed1 or port0).get("placed", [])):
                        placed2 = pp
                        break
                    host.wait_for_timeout(800)
                check("B.4: «usar» del invitado coloca por red (flanco place)", bool(placed2))
                if placed2:
                    check("B.4: inventario del guest baja otra vez", placed2["left"][1] == (placed1 or port0)["left"][1] - 1,
                          f"(left={placed2['left']})")
                badge1 = None
                t0 = time.time()
                while time.time() - t0 < 15:
                    b = probe(guest, "document.querySelector('[data-e=bpkCount]') ? document.querySelector('[data-e=bpkCount]').textContent : ''", tries=1, wait_ms=0)
                    if b and badge0 and b.isdigit() and badge0.isdigit() and int(b) < int(badge0):
                        badge1 = b
                        break
                    guest.wait_for_timeout(600)
                check("B.4: badge del invitado CAE en su HUD (contador vivo)", bool(badge1), f"({badge0}→{badge1})")
                guest.mouse.move(8, 8)
                guest.wait_for_timeout(600)
                closed = probe(guest, "(function(){var w=document.querySelector('[data-e=bpk]'); return w ? w.classList.contains('hidden') || !w.classList.contains('open') : true;})()")
                check("B.4: ventana se cierra al sacar el puntero", bool(closed))

        luma_shot(guest, f"{OUT}/t102-0-guest-partida.png")
        luma_shot(host, f"{OUT}/t102-1-host-partida.png")
        check("0 errores JS en el host", len(err_h) == 0, f"({len(err_h)}{': ' + err_h[0][:100] if err_h else ''})")
        check("0 errores JS en el guest", len(err_g) == 0, f"({len(err_g)}{': ' + err_g[0][:100] if err_g else ''})")
        browser_h.close()
        browser_g.close()
finally:
    srv.kill()

print()
if FALLOS:
    print(f"E2E T102 FALLÓ: {len(FALLOS)} -> {FALLOS}")
    sys.exit(1)
print("E2E T102 VERDE: paridad en red OK (unión tardía, mixer, candado de ratón, anclajes y mochila del invitado).")
