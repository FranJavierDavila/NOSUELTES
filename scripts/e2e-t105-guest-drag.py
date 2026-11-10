#!/usr/bin/env python3
"""E2E T105 — EL INVITADO MUEVE SU SHERPA Y VE LAS MARCAS.

A) MINIMAPA: el invitado recibe el listado de presas del tramo (holdsStatic)
   aunque se perdió el primer bloque hud mientras montaba SU escena —
   `__NS_GUEST().mmCached >= 1` tras el `ready`/reintentos.
B) ANILLOS: el invitado pinta los anillos de alcance del snapshot (rr):
   `__NS_GUEST_RINGS().reach > 0`.
C) DRAG REMOTO: el RATÓN del invitado sobre SU mano (proyección del snapshot)
   arrastra la extremidad EN EL HOST (rig.dragging = hand_l) y al soltar se
   libera. El host ve el drag y la simulación mueve a SU azul.
D) 0 errores JS en ambos.

Sirve el EXPORT estático bajo /NOSUELTES (igual que github.io)."""
import subprocess
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts")
# (el servidor lo arranca start_servers más abajo)

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


def menu(page):
    page.goto(BASE, wait_until="domcontentloaded")
    wait_el(page, "button[data-a=net]", timeout_s=120)


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
    from playwright.sync_api import sync_playwright
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

        print("== unión REAL en reposo; GO; paridad ==", flush=True)
        menu(host)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        ctx_g = browser_g.new_context(viewport={"width": 560, "height": 400})
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        menu(guest)
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
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
        check("código de sala recibido", bool(code2 and len(code2) == 4), f"(código={code2!r})")
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
            # el texto de estado es veloz y a veces ya cambió; la EVIDENCIA de
            # la unión es hasGuest en el host (o el estado del guest)
            st = probe(guest, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()", tries=1, wait_ms=0) or ""
            if "Esperando a que el anfitri" in st:
                ok_join = True
                break
            try:
                nh = host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netHost && __SHERPAS_DEBUG.netHost()")
                if nh and nh.get("hasGuest"):
                    ok_join = True
                    break
            except Exception:
                pass
            guest.wait_for_timeout(500)
        check("guest unido a la sala (señalización Nostr real)", ok_join)

        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        js_click(host, "button[data-a=netBack]")
        host.wait_for_timeout(300)
        js_click(host, "button[data-a=go]")
        for _ in range(10):
            page_skip = None
            try:
                host.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            host.wait_for_timeout(600)
        t0 = time.time()
        ok_match = False
        while time.time() - t0 < 120:
            try:
                if host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.drag(0)") is not None:
                    ok_match = True
                    break
            except Exception:
                pass
            host.wait_for_timeout(1500)
        check("partida arrancada con guest conectado", ok_match)
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
        check("guest renderiza snapshots (P2P)", ok_guest)

        print("== A: minimapa del invitado — listado de presas del tramo (ready/reintentos) ==", flush=True)
        mm = None
        t0 = time.time()
        while time.time() - t0 < 45:
            mm = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if mm and mm.get("mmCached", 0) >= 1 and mm.get("mmKey"):
                break
            guest.wait_for_timeout(1200)
        check("A: holdsStatic del tramo CACHÉ en el invitado (mmCached>=1)",
              bool(mm and mm.get("mmCached", 0) >= 1), f"(mm={ {k: mm.get(k) for k in ('mmCached', 'mmKey')} if mm else None })")

        print("== B: anillos de alcance replicados en el invitado ==", flush=True)
        rings = None
        t0 = time.time()
        while time.time() - t0 < 60:
            rings = probe(guest, "window.__NS_GUEST_RINGS && __NS_GUEST_RINGS()", tries=1, wait_ms=0)
            if rings and (rings.get("reach") or 0) > 0:
                break
            guest.wait_for_timeout(1500)
        check("B: anillos de alcance VISIBLES en el invitado (reach>0)",
              bool(rings and (rings.get("reach") or 0) > 0),
              f"(reach={(rings or {}).get('reach')}, activos={len((rings or {}).get('active', []))})")

        print("== C: el RATÓN del invitado arrastra SU mano EN EL HOST ==", flush=True)
        wait_unfrozen(host)
        done = False
        for intento in range(5):
            limb = ("hand_l", "hand_r", "foot_l", "foot_r", "hand_l")[intento]
            w = probe(guest, f"window.__NS_GUEST_LIMB && __NS_GUEST_LIMB(1, '{limb}')")
            if not w:
                guest.wait_for_timeout(1500)
                continue
            guest.mouse.move(w["x"], w["y"])
            guest.mouse.down()
            guest.wait_for_timeout(600)
            g_drag = probe(guest, "window.__NS_GUEST && __NS_GUEST().drag", tries=1, wait_ms=0)
            h_drag = None
            t0 = time.time()
            while time.time() - t0 < 6:
                h_drag = probe(host, "__SHERPAS_DEBUG.drag(1)", tries=1, wait_ms=0)
                if h_drag and h_drag.get("dragging"):
                    break
                host.wait_for_timeout(500)
            # arrastrar un poco por la pared y soltar
            guest.mouse.move(w["x"] + 12, w["y"] - 14, steps=6)
            guest.wait_for_timeout(700)
            guest.mouse.up()
            guest.wait_for_timeout(900)
            h_after = probe(host, "__SHERPAS_DEBUG.drag(1)", tries=1, wait_ms=0)
            net_h = probe(host, "__SHERPAS_DEBUG.netHost && __SHERPAS_DEBUG.netHost()", tries=1, wait_ms=0)
            rd = probe(host, "__SHERPAS_DEBUG.remoteDrag && __SHERPAS_DEBUG.remoteDrag()", tries=1, wait_ms=0)
            print(f"  [DBG] intento {intento + 1} {limb} @({w['x']:.0f},{w['y']:.0f}): guest.drag={g_drag} "
                  f"host.drag={h_drag} net={net_h} match.remoteDrag={rd}", flush=True)
            if h_drag and h_drag.get("dragging"):
                check(f"C: drag del invitado llega al HOST (intento {intento + 1}, {limb})", True, f"(host={h_drag})")
                check("C: al soltar la extremidad se libera en el host",
                      (h_after or {}).get("dragging") is None, f"(tras up: {h_after})")
                done = True
                break
            wait_unfrozen(host, timeout_s=15)
        if not done:
            check("C: drag del invitado llega al HOST", False, "(5 intentos sin begin)")

        print("== D: sin errores JS ==", flush=True)
        check("0 errores JS en el host", len(err_h) == 0, f"({len(err_h)}{': ' + err_h[0][:100] if err_h else ''})")
        check("0 errores JS en el guest", len(err_g) == 0, f"({len(err_g)}{': ' + err_g[0][:100] if err_g else ''})")
        try:
            guest.screenshot(path=f"{OUT}/t105-guest-partida.png", timeout=20000)
            host.screenshot(path=f"{OUT}/t105-host-partida.png", timeout=20000)
        except Exception as e:
            print(f"  (capturas omitidas: {e.__class__.__name__})", flush=True)
        browser_h.close()
        browser_g.close()
finally:
    srv.kill()

print()
if FALLOS:
    print(f"E2E T105 FALLÓ: {len(FALLOS)} -> {FALLOS}")
    sys.exit(1)
print("E2E T105 VERDE: invitado con drag de ratón, anillos y minimapa.")
