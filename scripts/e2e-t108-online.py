#!/usr/bin/env python3
"""E2E T108 — NOMBRES VERDE/ROJO + CHAT AMBOS LADOS (botón y Enter) + VOZ + ANCLAS.

A) CHAT: el invitado escribe por Enter → el host lo ve como "Rojo: …";
   el host abre por BOTÓN (chip clickable) y responde → "Verde: …" en el invitado.
B) VOZ (dispositivos FAKE de Chromium): ambos lados terminan con mic 'live' y
   >=1 stream remoto recibido.
C) ANCLAS (regresión T107d): mochila del invitado → armar por red → soltar
   mano → ancla clavada.
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
    """Enter → foco del input → escribe → Enter. Devuelve (ok, diag)."""
    page.keyboard.press("Enter")
    ok = False
    for _ in range(14):
        try:
            if page.evaluate("(function(){var i=document.querySelector('[data-e=chatIn]'); return !!i && document.activeElement === i;})()"):
                ok = True
                break
        except Exception:
            pass
        page.wait_for_timeout(350)
    if not ok:
        return False
    page.keyboard.type(text, delay=12)
    page.keyboard.press("Enter")
    return True


def chat_send_button(page, text):
    """Clic en el chip del chat → foco → escribe → Enter (camino antifallos)."""
    js_click(page, "[data-e=chatHint]")
    ok = False
    for _ in range(12):
        try:
            if page.evaluate("(function(){var i=document.querySelector('[data-e=chatIn]'); return !!i && document.activeElement === i;})()"):
                ok = True
                break
        except Exception:
            pass
        page.wait_for_timeout(350)
    if not ok:
        page.keyboard.press("Escape")  # no dejar la entrada abierta colgada
        return False
    page.keyboard.type(text, delay=12)
    page.keyboard.press("Enter")
    return True


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
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
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
        print("== A) chat online (Rojo/Verde, botón y Enter) ==", flush=True)
        sent1 = chat_send(guest, "hola soy el sherpa rojo")
        check("A1) el invitado (Rojo) abre por ENTER y envía", sent1)
        seen_h = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if ("Rojo: hola soy el sherpa rojo" in chat_log(host)
                    or "Red: hola soy el sherpa rojo" in chat_log(host)):
                seen_h = True
                break
            host.wait_for_timeout(500)
        check("A2) el host ve «Rojo/Red: …» (nombre nuevo + P2P)", seen_h, f"log={chat_log(host)!r}")
        sent2 = chat_send_button(host, "recibido verde, voy por la izquierda")
        check("A3) el host abre por BOTÓN y responde", sent2)
        seen_g = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if ("Verde: recibido verde" in chat_log(guest)
                    or "Green: recibido verde" in chat_log(guest)):
                seen_g = True
                break
            guest.wait_for_timeout(500)
        check("A4) el invitado ve «Verde/Green: …»", seen_g, f"log={chat_log(guest)!r}")

        # ---------- B) VOZ ----------
        print("== B) chat de voz (dispositivos fake) ==", flush=True)
        vh = None
        vg = None
        t0 = time.time()
        while time.time() - t0 < 30:
            try:
                vh = host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet && __SHERPAS_DEBUG.voiceNet()")
                vg = guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet && __SHERPAS_DEBUG.voiceNet()")
            except Exception:
                pass
            if vh and vg and vh.get("st") == "live" and vg.get("st") == "live" \
                    and vh.get("remote", 0) >= 1 and vg.get("remote", 0) >= 1:
                break
            host.wait_for_timeout(700)
            guest.wait_for_timeout(700)
        check("B1) micrófono LIVE en ambos (auto al abrirse la sesión)", bool(vh and vg and vh.get("st") == "live" and vg.get("st") == "live"), f"host={vh} guest={vg}")
        check("B2) cada lado recibe el stream del otro (sincronizado)", bool(vh and vg and vh.get("remote", 0) >= 1 and vg.get("remote", 0) >= 1), f"host={vh} guest={vg}")
        # silenciar desde el host y verificar el chip
        js_click(host, "[data-e=micBtn]")
        host.wait_for_timeout(800)
        vh2 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet()", tries=1, wait_ms=0)
        check("B3) el chip silencia el mic del host", bool(vh2 and vh2.get("st") == "muted"), f"host={vh2}")
        js_click(host, "[data-e=micBtn]")
        host.wait_for_timeout(600)

        # ---------- C) ANCLAS DEL INVITADO (regresión T107d) ----------
        print("== C) anclas del invitado ==", flush=True)
        port0 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        bp = probe(guest, "window.__NS_GUEST_BPK && __NS_GUEST_BPK(1)")
        opened = False
        if bp:
            guest.mouse.click(bp["x"], bp["y"])
            guest.wait_for_timeout(900)
            opened = probe(guest, "(function(){var b=document.querySelector('[data-e=bpk]'); return b && !b.classList.contains('hidden');})()", tries=1, wait_ms=0)
        if opened:
            js_click(guest, "[data-e=bpkSlot]")
        armed = False
        p = None
        t0 = time.time()
        while time.time() - t0 < 15:
            p = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
            if p and p.get("armed") and p["armed"][1]:
                armed = True
                break
            host.wait_for_timeout(500)
        check("C1) mochila del Rojo → host ARMA por red", armed, f"portables={p}")
        placed_now = False
        if armed:
            # soltar la mano: el drag REMOTO real ya está verificado en T105;
            # aquí usamos el MISMO handler (rd → remoteDrag) de forma
            # determinista sobre la mano derecha del snapshot
            hand = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.limb(1, 'hand_r')")
            if hand:
                gx, gy = round(hand["x"], 2), round(max(1.25, hand["y"] + 0.55), 2)
                host.evaluate(f"window.__SHERPAS_DEBUG.rd({{k:'b', l:'hand_r', x:{hand['x']}, y:{hand['y']}}})")
                host.wait_for_timeout(600)
                host.evaluate(f"window.__SHERPAS_DEBUG.rd({{k:'m', x:{gx}, y:{gy}}})")
                host.wait_for_timeout(600)
                host.evaluate("window.__SHERPAS_DEBUG.rd({k:'e'})")
                host.wait_for_timeout(1800)
                p = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
                placed_now = bool(p and p.get("placed") and len(p["placed"]) > len(port0.get("placed") or []))
        check("C2) soltar mano (remoteDrag) → ancla clavada", placed_now,
              f"antes={port0 and len(port0.get('placed') or [])} ahora={p and p.get('placed')} left={p and p.get('left') if p else None}")

        check("D) 0 errores JS en ambas pestañas", not err_h and not err_g,
              f"host={err_h[:2]} guest={err_g[:2]}")
        browser_h.close()
        browser_g.close()
finally:
    srv.kill()

print(f"\nE2E T108: {'FALLOS: ' + ', '.join(FALLOS) if FALLOS else 'VERDE'}")
sys.exit(1 if FALLOS else 0)
