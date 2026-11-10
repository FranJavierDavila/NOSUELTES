#!/usr/bin/env python3
"""E2E T102 — RED 2 JUGADORES JUGABLE (reporte del anfitrión: el invitado no
podía mover su sherpa, ni colocar anclajes, ni usar su mochila; y el anfitrión
movía a ambos).

FASE A — P2P REAL (join antes del GO, patrón T86 con relays Nostr vivos):
  a. El anfitrión crea sala (código local de 4) y el invitado se une de verdad.
  b. GO → el guest construye la pared y renderiza snapshots.
  c. CANDADO DE ARRASTRE: el ratón del anfitrión ya NO agarra extremidades del
     azul (drag(1).dragging null) pero sí las suyas (drag(0) = hand_l).
  d. TECLAS DEL GUEST: ArrowLeft reiterado → los intents llegan al host (>20);
     aim dx (informativo bajo SwiftShader, como T86).
  e. MOCHILA DEL GUEST: clic en SU azul abre la ventana (badge «10»), el clic
     en la del anfitrión NO abre; «usar» con las 4 agarradas no coloca (aviso
     legítimo); KeyI (toggle de SU mano izquierda) + «usar» → anclaje colocado
     en el host (left 10→9, placed+1) y el badge del guest baja a «9» (réplica).
FASE B — UNIÓN A MITAD DE PARTIDA (determinista con netFake: SwiftShader ahoga
  los offers WebRTC con el rAF de la partida en marcha; netFake dispara los
  MISMOS handlers que un peer real):
  a. GO sin guest → netFake(true) → snapshots publicándose (snaps crece) y
     candado de arrastre activo también en unión tardía.
  b. netFake(false) → RELEVO: el anfitrión vuelve a poder mover al azul.
"""
import functools
import http.server
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image as _Img

BASE = "http://127.0.0.1:8777/NOSUELTES"
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def info(nombre, detalle=""):
    print(f"  [INFO] {nombre} {detalle}")


def probe(page, expr, tries=8, wait_ms=400):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(wait_ms)
    return None


def luma_shot(page, path):
    try:
        page.screenshot(path=path, timeout=30000)
    except Exception as e:
        print(f"  (captura omitida: {e.__class__.__name__})")
        return
    img = _Img.open(path).convert("L")
    w, h = img.size
    c = img.crop((int(w * 0.25), int(h * 0.3), int(w * 0.75), int(h * 0.85)))
    print(f"  luma {sum(c.getdata()) / (c.width * c.height):.0f} -> {os.path.basename(path)}")


def wait_el(page, sel, timeout_s=25):
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


def net_text(page):
    return probe(page, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()", tries=1, wait_ms=0) or ""


def drag_test(page, player, limb, want):
    """pointerdown real sobre la extremidad proyectada y SONDEO del estado:
    con SwiftShader el handler del pointerdown puede tardar ~2 s en correr.
    want='drag' → devuelve en cuanto haya arrastre; want='blocked' → sondea
    un rato largo y devuelve el último estado (debe seguir null).
    Espera además una GEOMETRÍA SANA (rayo de pared finite en el píxel): la
    cámara de inicio de partida puede estar volando (rayos paralelos → NaN).
    Devuelve (estado, pixel, diagnóstico round-trip pared+cámara)."""
    diag_cam = page.evaluate("""(() => {
        const c = __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()?.camera;
        return c ? { pos: [c.position.x, c.position.y, c.position.z],
                    fwd: c.forward ? [c.forward.x, c.forward.y, c.forward.z] : null } : null;
    })()""")
    pos = None
    tgeo = time.time()
    while time.time() - tgeo < 20:
        pos = page.evaluate(f"""(() => {{
            const w = __SHERPAS_DEBUG.limb({player}, '{limb}');
            if (!w) return null;
            return __SHERPAS_DEBUG.project(w.x, w.y, w.z);
        }})()""")
        if not pos:
            page.wait_for_timeout(800)
            continue
        w = page.evaluate(f"__SHERPAS_DEBUG.wall({pos['x']}, {pos['y']})")
        if w and w.get("x") == w.get("x") and w.get("y") == w.get("y"):  # no NaN
            break
        page.wait_for_timeout(800)
        pos = None
    if not pos:
        return None, None, {"cam": diag_cam, "motivo": "geometría no saneada en 20 s"}
    diag = page.evaluate("""([px, py, p, lb]) => {
        const w = __SHERPAS_DEBUG.wall(px, py);
        const lp = __SHERPAS_DEBUG.limb(p, lb);
        return { wall: w, limb: lp ? { x: lp.x, y: lp.y, z: lp.z } : null,
                 dist: (w && lp) ? Math.hypot(w.x - lp.x, w.y - lp.y) : null };
    }""", [pos["x"], pos["y"], player, limb])
    diag = dict(diag or {}, cam=diag_cam)
    page.mouse.move(pos["x"], pos["y"])
    page.wait_for_timeout(150)
    page.mouse.down()
    d, t0 = None, time.time()
    limite = 8 if want == "drag" else 5
    while time.time() - t0 < limite:
        d = probe(page, f"__SHERPAS_DEBUG.drag({player})", tries=1, wait_ms=0)
        if want == "drag" and d and d.get("dragging"):
            break
        page.wait_for_timeout(600)
    page.mouse.up()
    page.wait_for_timeout(200)
    return d, pos, diag


def wait_badge(page, val, timeout_s=30):
    t0 = time.time()
    b = None
    while time.time() - t0 < timeout_s:
        b = page.evaluate("document.querySelector('.sphud .bpk [data-e=bpkCount]')?.textContent ?? null")
        if b == val:
            return b
        page.wait_for_timeout(800)
    return b


def bpk_state(page):
    return page.evaluate("""(() => {
        const w = document.querySelector('.sphud .bpk');
        if (!w) return null;
        return { visible: !w.classList.contains('hidden'), open: w.classList.contains('open'),
                 count: w.querySelector('[data-e=bpkCount]')?.textContent ?? null,
                 title: w.querySelector('[data-e=bpkTitle]')?.textContent ?? '' };
    })()""")


def bpk_click(page):
    box = page.evaluate("(() => { const r = document.querySelector('.sphud .bpk-slot').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()")
    page.mouse.click(box["x"], box["y"])


def key_once(page, code):
    page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keydown', {{ key: {code!r}, code: {code!r} }}))")
    page.wait_for_timeout(300)
    page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keyup', {{ key: {code!r}, code: {code!r} }}))")
    page.wait_for_timeout(200)


def wait_camara_sana(page, timeout_s=150):
    """Bajo SwiftShader (~1 fps) la transición de cámara menú→partida tarda
    ~1 min de reloj: mientras vuela, los rayos de pared dan NaN/null (cámara
    detrás del plano). Espera a que wall() del centro devuelva un punto finite."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        w = page.evaluate("__SHERPAS_DEBUG.wall(280, 200)")
        if w and w.get("x") == w.get("x") and w.get("y") == w.get("y"):
            return True
        page.wait_for_timeout(1500)
    return False


def start_server():
    proc = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "8777"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import urllib.request
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE, timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("el servidor de out/ no arrancó")


server = start_server()
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
        # español para los textos que grepea la sonda (T100: EN por defecto)
        ctx_h.add_init_script("try{localStorage.setItem('ns.lang.v1','es')}catch(e){}")
        ctx_h.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx_h.new_page()
        err_h, cons_h = [], []
        host.on("pageerror", lambda e: err_h.append(str(e)))

        print("== FASE A · HOST: crea la sala ==")
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
        check("código de sala recibido", bool(code and len(code) == 4), f"(código={code!r})")
        code = code or "AAAA"

        print("== FASE A · GUEST: unión REAL por relays Nostr ==")
        ctx_g = browser_g.new_context(viewport={"width": 560, "height": 400})
        ctx_g.add_init_script("try{localStorage.setItem('ns.lang.v1','es')}catch(e){}")
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        menu(guest)
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
        guest.evaluate("""(code) => {
          const el = document.querySelector('[data-a=netCode]');
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(el, code);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""", code)
        js_click(guest, "[data-a=netJoin]")
        ok_join = False
        t0 = time.time()
        while time.time() - t0 < 30:  # relays públicos: margen de señalización
            if "Esperando a que el anfitri" in net_text(guest):
                ok_join = True
                break
            guest.wait_for_timeout(500)
        if not ok_join:
            print(f"  [DBG] estado guest: {net_text(guest)!r}")
        check("guest unido y esperando sesión", ok_join)
        ok_host_sees = False
        t0 = time.time()
        while time.time() - t0 < 10:
            if "conectado" in net_text(host).lower():
                ok_host_sees = True
                break
            host.wait_for_timeout(400)
        check("host ve al compañero conectado", ok_host_sees)

        print("== FASE A · GO: partida real en ambos ==")
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        js_click(host, "button[data-a=netBack]")
        host.wait_for_timeout(400)
        js_click(host, "button[data-a=go]")
        for _ in range(10):
            host.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            host.wait_for_timeout(600)
        ok_match = False
        t0 = time.time()
        while time.time() - t0 < 120:
            try:
                if host.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                    ok_match = True
                    break
            except Exception:
                pass
            host.wait_for_timeout(1500)
        check("partida del host arrancada", ok_match)
        host.wait_for_timeout(6000)
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
        check("anfitrión NO congelado (caída/cumbre)", probe(host, "__SHERPAS_DEBUG.frozen()") is False)

        print("== CANDADO: el ratón del host ya no mueve al azul ==")
        check("cámara de partida asentada (rayos de pared finite)", wait_camara_sana(host), "")
        da, posa, dga = drag_test(host, 0, "hand_l", "drag")
        check("drag del NARANJA propio funciona", da is not None and da.get("dragging") == "hand_l",
              f"(drag={da} diag={dga})")
        host.wait_for_timeout(6000)  # asienta cámara/extremidad tras el tirón
        db, posb, dgb = drag_test(host, 1, "hand_l", "blocked")
        check("drag del AZUL bloqueado con guest", db is not None and db.get("dragging") is None,
              f"(drag={db} diag={dgb})")

        print("== TECLAS DEL GUEST: ArrowLeft → intents en el host ==")
        n0 = probe(host, "__SHERPAS_DEBUG.net()") or {}
        aim0 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(true)")
        for _ in range(14):
            guest.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }))")
            guest.wait_for_timeout(900)
            guest.evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft' }))")
            guest.wait_for_timeout(100)
        guest.evaluate("window.__NS_GUEST_HOLD && __NS_GUEST_HOLD(false)")
        guest.wait_for_timeout(800)
        n1 = probe(host, "__SHERPAS_DEBUG.net()") or {}
        aim1 = probe(host, "__SHERPAS_DEBUG.aim(1)") or {"x": 0, "y": 0}
        dx = (aim0.get("x") or 0) - (aim1.get("x") or 0)
        di = (n1.get("intents") or 0) - (n0.get("intents") or 0)
        check("intents del guest llegan al host (>20)", di > 20, f"(+{di})")
        tag = "OK " if dx > 0.05 else "INFO"
        print(f"  [{tag}] aim de P2 con teclado del guest (dx={dx:.3f} m)")

        print("== MOCHILA DEL GUEST: ventana, usar→anclaje, veto a la del anfitrión ==")
        # aim alto y despejado del AZUL: el «usar» del guest debe poder colicar
        # (DESPUÉS de los tests de arrastre: la cámara sigue el aim)
        host.evaluate("__SHERPAS_DEBUG.setAim(1, 0.2, 6)")
        before = probe(host, "__SHERPAS_DEBUG.portables()") or {}
        p1 = guest.evaluate("window.__NS_GUEST_BPK && __NS_GUEST_BPK(1)")
        ok_vent = False
        if p1:
            guest.mouse.click(p1["x"], p1["y"])
            guest.wait_for_timeout(2500)  # despliegue (~2 s/fotograma)
            st = bpk_state(guest)
            ok_vent = bool(st and st.get("visible") and st.get("open"))
            check("ventana de SU mochila ABIERTA en el guest", ok_vent, f"{st}")
            badge = wait_badge(guest, "10", 30)
            check("badge del Anclaje llega a «10» (contador vivo del snapshot)", badge == "10", f"badge={badge!r}")
            check("título «Mochila · Jugador 2»", st and "Mochila" in (st.get("title") or ""), f"{st and st.get('title')}")
            luma_shot(guest, f"{OUT}/t102-guest-mochila.png")
            if ok_vent and badge == "10":
                # 1er «usar» con las 4 agarradas: no coloca (aviso legítimo);
                # el ratón NO sale de la ventana (el cierre es por pointerleave)
                bpk_click(guest)
                guest.wait_for_timeout(8000)
                mid = probe(host, "__SHERPAS_DEBUG.portables()") or {}
                info("usar con 4 agarradas: sin colocación",
                     f"placed antes={len(before.get('placed') or [])} después={len(mid.get('placed') or [])}")
                # KeyI del guest = toggle de SU mano izquierda (P2)
                key_once(guest, "KeyI")
                guest.wait_for_timeout(2500)
                # «usar» de verdad → flanco place por red → anclaje del azul
                bpk_click(guest)
                after, badge2 = mid, None
                t1 = time.time()
                while time.time() - t1 < 60:
                    guest.wait_for_timeout(2500)
                    after = probe(host, "__SHERPAS_DEBUG.portables()") or {}
                    badge2 = guest.evaluate("document.querySelector('.sphud .bpk [data-e=bpkCount]')?.textContent ?? null")
                    l1 = (after.get("left") or [0, 0])[1]
                    if l1 == (before.get("left") or [0, 0])[1] - 1 and len(after.get("placed") or []) > len(mid.get("placed") or []):
                        break
                check("«usar» del guest COLOCA el anclaje en el host (10→9)",
                      bool(after) and (after.get("left") or [0, 0])[1] == (before.get("left") or [0, 0])[1] - 1
                      and len(after.get("placed") or []) > len(mid.get("placed") or []),
                      f"left={after.get('left')} placed={len(after.get('placed') or [])}")
                badge3 = wait_badge(guest, "9", 25)  # el snapshot puede tardar un ciclo más que el host
                check("badge del guest baja a «9» (réplica del snapshot)", badge3 == "9", f"badge={badge3!r}")
                luma_shot(host, f"{OUT}/t102-host-con-anclaje.png")
            # VETO al final (mover el ratón cierra la SUYA por pointerleave):
            # el clic en la mochila del anfitrión jamás muestra la de Jugador 1
            p0 = guest.evaluate("window.__NS_GUEST_BPK && __NS_GUEST_BPK(0)")
            if p0:
                guest.mouse.click(p0["x"], p0["y"])
                guest.wait_for_timeout(1200)
                st0 = bpk_state(guest)
                check("la mochila del ANFITRIÓN no abre en el guest",
                      "Jugador 1" not in (st0 or {}).get("title", ""), f"{st0}")
        else:
            check("ventana de SU mochila ABIERTA en el guest", False, "(sin proyección __NS_GUEST_BPK)")

        check("0 errores JS en el host", len(err_h) == 0, f"({len(err_h)}{': ' + err_h[0][:100] if err_h else ''})")
        check("0 errores JS en el guest", len(err_g) == 0, f"({len(err_g)}{': ' + err_g[0][:100] if err_g else ''})")

        print("== FASE B · UNIÓN A MITAD DE PARTIDA (netFake determinista) ==")
        ctx_h2 = browser_h.new_context(viewport={"width": 560, "height": 400})
        ctx_h2.add_init_script("try{localStorage.setItem('ns.lang.v1','es')}catch(e){}")
        ctx_h2.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host2 = ctx_h2.new_page()
        err_h2 = []
        host2.on("pageerror", lambda e: err_h2.append(str(e)))
        menu(host2)
        host2.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host2, "button[data-a=net]")
        wait_el(host2, "[data-a=netHost]")
        js_click(host2, "[data-a=netHost]")
        host2.wait_for_timeout(2500)  # sala creada (código local)
        js_click(host2, "button[data-a=netBack]")
        js_click(host2, "button[data-a=go]")
        for _ in range(10):
            host2.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            host2.wait_for_timeout(600)
        ok2 = False
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                if host2.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"):
                    ok2 = True
                    break
            except Exception:
                pass
            host2.wait_for_timeout(1500)
        check("partida a mitad (sin guest) arrancada", ok2)
        host2.evaluate("__SHERPAS_DEBUG.netFake(true)")
        s0 = probe(host2, "__SHERPAS_DEBUG.net()") or {}
        host2.wait_for_timeout(9000)
        s1 = probe(host2, "__SHERPAS_DEBUG.net()") or {}
        check("unión tardía: snapshots publicándose", (s1.get("snaps") or 0) - (s0.get("snaps") or 0) > 0,
              f"(snaps {s0.get('snaps')}→{s1.get('snaps')})")
        wait_camara_sana(host2)
        dlb, _, _ = drag_test(host2, 1, "hand_l", "blocked")
        check("unión tardía: drag del azul BLOQUEADO", dlb is not None and dlb.get("dragging") is None, f"{dlb}")
        host2.evaluate("__SHERPAS_DEBUG.netFake(false)")
        host2.wait_for_timeout(800)
        dla, _, _ = drag_test(host2, 1, "hand_l", "drag")
        check("RELEVO tras irse el guest: drag del azul restaurado",
              dla is not None and dla.get("dragging") == "hand_l", f"{dla}")
        check("0 errores JS en la FASE B", len(err_h2) == 0, f"({len(err_h2)})")

        browser_h.close()
        browser_g.close()
finally:
    server.kill()

print()
if FALLOS:
    print(f"SONDA T102 FALLÓ: {len(FALLOS)} -> {FALLOS}")
    sys.exit(1)
print("SONDA T102 TODO VERDE: red 2 jugadores jugable (candado, teclas, mochila del guest, relevo).")
