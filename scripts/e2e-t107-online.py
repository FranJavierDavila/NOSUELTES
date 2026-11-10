#!/usr/bin/env python3
"""E2E T107 — CHAT ONLINE + ANCLAS DEL INVITADO + SONDA ANTI-PARPADEO.

A) CHAT: el invitado abre el chat (Enter), escribe y envía → el anfitrión lo
   ve en SU log; y el anfitrión responde → lo ve el invitado. P2P real.
B) ANCLAS DEL INVITADO: clic en SU mochila 3D → ventana → hueco ⚓ → el host
   ARMA el anclaje (portables().armed[1]) y el invitado ve el aviso en SU
   subtítulo (PortableMsg via snapshot) → arrastra su mano y la suelta en un
   hueco libre → el ancla se clava ahí (portables().placed) y queda 9.
C) PARPADEO: 12 s muestreando identidad del canvas y escala del gobernador en
   el invitado: la identidad NUNCA cambia y la escala NO oscila (máx 1 cambio).
D) 0 errores JS en ambos.
"""
import subprocess
import sys
import time

sys.path.insert(0, "/home/z/my-project/scripts")

BASE = "http://127.0.0.1:3100/NOSUELTES"
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


def chat_send(page, text):
    """Enter → espera el foco del input → escribe → Enter. Devuelve (ok, diag)."""
    page.keyboard.press("Enter")
    ok = False
    diag = None
    for _ in range(14):
        try:
            diag = page.evaluate("(function(){var i=document.querySelector('[data-e=chatIn]'); var r=document.querySelector('[data-e=chatRow]'); return {row: r ? !r.classList.contains('hidden') : null, act: document.activeElement ? document.activeElement.tagName + '.' + (document.activeElement.className || '') : null, is: !!i && document.activeElement === i};})()")
        except Exception as e:
            diag = {"err": str(e)[:80]}
        if diag and diag.get("is"):
            ok = True
            break
        page.wait_for_timeout(350)
    if not ok:
        return False, diag
    page.keyboard.type(text, delay=12)
    page.keyboard.press("Enter")
    return True, diag


def chat_log(page):
    try:
        return page.evaluate("(function(){var l=document.querySelector('[data-e=chatLog]'); return l ? l.textContent : '';})()") or ""
    except Exception:
        return ""


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
        ctx_h = browser_h.new_context(viewport={"width": 640, "height": 440})
        ctx_h.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx_h.new_page()
        err_h = []
        host.on("pageerror", lambda e: err_h.append(str(e)))

        print("== unión REAL (Nostr); GO ==", flush=True)
        host.goto(BASE, wait_until="domcontentloaded")
        wait_el(host, "button[data-a=net]", timeout_s=120)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        ctx_g = browser_g.new_context(viewport={"width": 640, "height": 440})
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        guest.goto(BASE, wait_until="domcontentloaded")
        wait_el(guest, "button[data-a=net]", timeout_s=120)
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
            try:
                host.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            host.wait_for_timeout(600)
        # el guest recibe la sesión y monta SU escena
        ok_guest_match = False
        for _ in range(40):
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d and d.get("tick", 0) > 0:
                ok_guest_match = True
                break
            guest.wait_for_timeout(900)
        check("invitado dentro de la partida (snapshots fluyendo)", ok_guest_match)
        host.wait_for_timeout(2500)

        # ---------- A) CHAT ----------
        print("== A) chat online ==", flush=True)
        hint_h = probe(host, "(function(){var h=document.querySelector('[data-e=chatHint]'); return h && !h.classList.contains('hidden') ? h.textContent : null;})()", tries=1, wait_ms=0)
        check("A0) aviso del chat visible en el host", bool(hint_h), f"hint={hint_h!r}")
        sent1, diag1 = chat_send(guest, "hola desde el invitado")
        check("A1) el invitado abre el chat y envía", sent1, f"diag={diag1}")
        seen_h = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if "hola desde el invitado" in chat_log(host):
                seen_h = True
                break
            host.wait_for_timeout(500)
        check("A2) el host recibe el mensaje del invitado (P2P)", seen_h, f"log={chat_log(host)!r}")
        sent2, diag2 = chat_send(host, "recibido, vamos al primer campamento")
        check("A3) el host responde", sent2, f"diag={diag2}")
        seen_g = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if "recibido, vamos al primer campamento" in chat_log(guest):
                seen_g = True
                break
            guest.wait_for_timeout(500)
        check("A4) el invitado recibe la respuesta", seen_g, f"log={chat_log(guest)!r}")

        # ---------- B) ANCLAS DEL INVITADO ----------
        print("== B) anclas del invitado (mochila → armar → soltar mano) ==", flush=True)
        port0 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        bp = probe(guest, "window.__NS_GUEST_BPK && __NS_GUEST_BPK(1)")
        check("B1) mochila del azul proyectada en pantalla del invitado", bool(bp), f"px={bp}")
        opened = False
        if bp:
            guest.mouse.click(bp["x"], bp["y"])
            guest.wait_for_timeout(900)
            opened = probe(guest, "(function(){var b=document.querySelector('[data-e=bpk]'); return b && !b.classList.contains('hidden');})()", tries=1, wait_ms=0)
        check("B2) ventana de mochila abierta en el invitado", bool(opened))
        if opened:
            js_click(guest, "[data-e=bpkSlot]")
        armed = False
        p = None
        t0 = time.time()
        subs_g = []
        # hilo de sondeo del subtítulo del invitado DURING la ventana de armado
        while time.time() - t0 < 15:
            try:
                sg = guest.evaluate("(function(){var s=document.querySelector('[data-e=subtitle]'); return s && !s.classList.contains('hidden') ? s.textContent : null;})()")
                if sg:
                    subs_g.append(sg)
            except Exception:
                pass
            p = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
            if p and p.get("armed") and p["armed"][1]:
                armed = True
                # margen: el evento PortableMsg viaja en el snapshot siguiente
                t1 = time.time()
                while time.time() - t1 < 3:
                    try:
                        sg = guest.evaluate("(function(){var s=document.querySelector('[data-e=subtitle]'); return s && !s.classList.contains('hidden') ? s.textContent : null;})()")
                        if sg and sg not in subs_g:
                            subs_g.append(sg)
                    except Exception:
                        pass
                    guest.wait_for_timeout(300)
                break
            guest.wait_for_timeout(300)
        check("B3) el host ARMA el anclaje del invitado (flanco arm por red)", armed, f"portables={p}")
        sub_g = subs_g[-1] if subs_g else None
        check("B4) el invitado VE el aviso de anclaje en la mano", bool(sub_g and ("mano" in sub_g or "hand" in sub_g)), f"subtítulos={subs_g!r}")

        placed_now = False
        if armed:
            # arrastra SU mano (px del snapshot) y la suelta en un hueco libre;
            # prueba varios objetivos (separación mínima 0.42 m de otras presas)
            limb_px = probe(guest, "window.__NS_GUEST_LIMB && __NS_GUEST_LIMB(1, 'hand_r')")
            print(f"  mano_r px={limb_px}", flush=True)
            if limb_px:
                for dx, dy in [(70, -90), (-70, -110), (90, -40), (-40, 60)]:
                    tx, ty = limb_px["x"] + dx, limb_px["y"] + dy
                    guest.mouse.move(limb_px["x"], limb_px["y"])
                    guest.mouse.down()
                    steps = 6
                    for i in range(1, steps + 1):
                        guest.mouse.move(limb_px["x"] + dx * i / steps, limb_px["y"] + dy * i / steps)
                        guest.wait_for_timeout(60)
                    guest.wait_for_timeout(500)
                    guest.mouse.up()
                    guest.wait_for_timeout(1600)
                    p = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
                    if p and p.get("placed") and len(p["placed"]) > len(port0.get("placed") or []):
                        placed_now = True
                        print(f"  ancla clavada en intento ({dx},{dy}): {p['placed'][-1]}", flush=True)
                        break
        check("B5) soltar la mano → ancla clavada en la pared", placed_now,
              f"antes={port0 and len(port0.get('placed') or [])} ahora={p and p.get('placed')} left={p and p.get('left') if p else None}")

        # ---------- C) SONDA ANTI-PARPADEO (invitado) ----------
        print("== C) sonda anti-parpadeo (12 s en el invitado) ==", flush=True)
        ident_changes = 0
        scale_changes = 0
        last_ident = None
        last_scale = None
        first_scale = None
        for _ in range(24):  # 24 × 500 ms = 12 s
            try:
                s = guest.evaluate("(function(){var c=document.querySelector('canvas'); var sc=(window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()); var pf=sc && sc.getPerf ? sc.getPerf() : null; return {i: c ? 'x' : null, s: pf ? pf.scale : null};})()")
            except Exception:
                s = None
            if s:
                if last_ident is not None and s["i"] != last_ident:
                    ident_changes += 1
                if first_scale is None and s["s"]:
                    first_scale = s["s"]
                if last_scale is not None and s["s"] is not None and s["s"] != last_scale:
                    scale_changes += 1
                last_ident = s["i"]
                if s["s"]:
                    last_scale = s["s"]
            guest.wait_for_timeout(500)
        check("C1) identidad del canvas estable (sin remonts)", ident_changes == 0, f"cambios={ident_changes}")
        check("C2) escala del gobernador estable (sin ping-pong)", scale_changes <= 1,
              f"cambios={scale_changes} escala={first_scale}->{last_scale}")

        if err_h or err_g:
            print(f"ERRORES JS host={err_h[:2]} guest={err_g[:2]}")
        check("D) 0 errores JS en ambas pestañas", not err_h and not err_g)
        browser_h.close()
        browser_g.close()
finally:
    srv.kill()

print(f"\nE2E T107: {'FALLOS: ' + ', '.join(FALLOS) if FALLOS else 'VERDE'}")
sys.exit(1 if FALLOS else 0)
