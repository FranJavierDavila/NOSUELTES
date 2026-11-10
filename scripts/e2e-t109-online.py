#!/usr/bin/env python3
"""E2E T109 — VOZ audible (RMS real con el tono del dispositivo falso),
chip de voz visible, bocadillos del ricachón en el INVITADO, GO dentro del
panel Online, debug oculto + comprobaciones pendientes de T108 (chat del
anfitrión por BOTÓN, anclas del invitado por red).

F0 GO+debug oculto+chip (netFake, 1 página) · F1 unión Nostr real ·
F2 chat botón/Enter (Rojo/Verde) · F3 voz live + RMS en ambos ·
F4 bocadillo rico → invitado · F5 anclas por red · F6 0 errores JS.
"""
import subprocess
import sys
import time

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


def rms_of_remote(page, tries=6):
    """Media del RMS del stream de voz REMOTO (AnalyserNode). El dispositivo
    falso de Chromium emite un tono: RMS > 0.003 = audio real fluyendo."""
    return page.evaluate("""async () => {
      const st = window.__SHERPAS_DEBUG;
      let s = st && st.voiceRemoteStream && st.voiceRemoteStream();
      for (let i = 0; i < 16 && (!s || !s.getAudioTracks().length); i++) {
        await new Promise(r => setTimeout(r, 400));
        s = st && st.voiceRemoteStream && st.voiceRemoteStream();
      }
      if (!s || !s.getAudioTracks().length) return -1;
      const C = window.AudioContext || window.webkitAudioContext;
      const ctx = new C();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let sum = 0, n = 0;
      for (let i = 0; i < 24; i++) {
        an.getFloatTimeDomainData(buf);
        let acc = 0;
        for (let j = 0; j < buf.length; j++) acc += buf[j] * buf[j];
        sum += Math.sqrt(acc / buf.length); n++;
        await new Promise(r => setTimeout(r, 60));
      }
      void ctx.close();
      return sum / Math.max(1, n);
    }""")


def chat_open_type(page, text, via_button=False):
    if via_button:
        js_click(page, "[data-e=chatHint]")
    else:
        page.keyboard.press("Enter")
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
        page.keyboard.press("Escape")
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
        ctx_h = browser_h.new_context(viewport={"width": 640, "height": 440})
        ctx_h.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx_h.new_page()
        err_h = []
        host.on("pageerror", lambda e: err_h.append(str(e)))

        # ---------- F0: GO dentro del panel Online + debug oculto (netFake) ----------
        print("== F0) GO en el panel Online + debug oculto (netFake) ==", flush=True)
        host.goto(BASE, wait_until="domcontentloaded")
        wait_el(host, "button[data-a=net]", timeout_s=120)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
        c0 = None
        t0 = time.time()
        while time.time() - t0 < 15:
            try:
                c0 = host.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
            except Exception:
                c0 = None
            if c0:
                break
            host.wait_for_timeout(400)
        check("F0-pre) sala real creada (código)", bool(c0 and len(c0) == 4), f"(código={c0!r})")
        go_visible = probe(host, "(function(){var b=document.querySelector('[data-a=netGo]'); return !!b && !!b.offsetParent;})", tries=1, wait_ms=0)
        check("F0a) botón GO visible dentro del panel Online", bool(go_visible))
        # El GO se pulsa cuando el invitado REAL esté dentro (F2): es el patrón
        # probado de T108 (unión con el anfitrión en el panel; los intentos de
        # unión a MITAD de partida contra SwiftShader caducan los offers).

        # ---------- F1: el invitado REAL se une a la sala de F0 ----------
        print("== F1) unión real (Nostr) ==", flush=True)
        browser_g = pw.chromium.launch(args=flags)
        ctx_g = browser_g.new_context(viewport={"width": 640, "height": 440})
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        # SwiftShader (T86): con el anfitrión EN PARTIDA el render software
        # ahoga el event loop y las ofertas WebRTC caducan antes de procesarse
        # (el invitado veía "sala-no-existe"). Viewport mínimo durante la
        # unión → frames baratos → la señalización respira. En GPU real esto
        # no ocurre; es un artefacto del E2E.
        host.set_viewport_size({"width": 200, "height": 150})
        guest.goto(BASE, wait_until="domcontentloaded")
        wait_el(guest, "button[data-a=net]", timeout_s=120)
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
        code2 = c0 or "BBBB"
        guest.evaluate("""(code) => {
          const el = document.querySelector('[data-a=netCode]');
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(el, code);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""", code2)
        js_click(guest, "[data-a=netJoin]")
        joined = False
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                nh = host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netHost && __SHERPAS_DEBUG.netHost()")
                if nh and nh.get("hasGuest"):
                    joined = True
                    break
            except Exception:
                pass
            guest.wait_for_timeout(600)
        if not joined:
            gst = probe(guest, "(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : null;})()", tries=1, wait_ms=0)
            print(f"  [diag] guest netStatus={gst!r}", flush=True)
        check("F1-pre) invitado real unido a la sala (anfitrión en panel)", joined)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        host.set_viewport_size({"width": 640, "height": 440})  # restaurar para las capturas

        # ---------- F2: GO DESDE EL PANEL con el invitado ya dentro ----------
        print("== F2) GO del panel Online ==", flush=True)
        js_click(host, "[data-a=netGo]")
        started = False
        for _ in range(14):
            started = probe(host, "(function(){var s=document.querySelector('[data-e=start]'); return !!s && s.classList.contains('hidden');})", tries=1, wait_ms=0)
            if started:
                break
            host.wait_for_timeout(700)
        check("F2a) GO del panel arranca la partida (sin volver a la portada)", bool(started))
        for _ in range(10):
            try:
                host.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            host.wait_for_timeout(600)
        host.wait_for_timeout(3000)
        dbg_hidden = probe(host, "(function(){var d=document.querySelector('[data-e=debug]'); return !!d && d.classList.contains('hidden');})", tries=1, wait_ms=0)
        check("F2b) línea de depuración OCULTA por defecto", bool(dbg_hidden))
        chip_h = probe(host, "(function(){var v=document.querySelector('[data-e=voice]'); return !!v && !v.classList.contains('hidden') && !!v.offsetParent;})", tries=1, wait_ms=0)
        check("F2c) chip de VOZ visible en el anfitrión (unión real)", bool(chip_h))
        host_st = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet()", tries=1, wait_ms=0)
        check("F2d) micrófono LIVE en el anfitrión (unión real)", bool(host_st and host_st.get("st") == "live"), f"st={host_st}")
        ok_guest = False
        t0 = time.time()
        while time.time() - t0 < 45:
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d and d.get("tick", 0) > 0:
                ok_guest = True
                break
            guest.wait_for_timeout(900)
        check("F1a) invitado real dentro de la partida (snapshots)", ok_guest)
        host.wait_for_timeout(2500)

        # ---------- F2: chat por BOTÓN y Enter (pendiente T108) ----------
        print("== F3) chat online (Rojo/Verde) ==", flush=True)
        sent1 = chat_open_type(guest, "hola soy el sherpa rojo")
        check("F3a) invitado (Rojo) envía por ENTER", sent1)
        seen_h = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if ("Rojo: hola" in chat_log(host)) or ("Red: hola" in chat_log(host)):
                seen_h = True
                break
            host.wait_for_timeout(500)
        check("F3b) anfitrión ve «Rojo/Red: …»", seen_h, f"log={chat_log(host)!r}")
        sent2 = chat_open_type(host, "recibido verde", via_button=True)
        check("F3c) anfitrión abre por BOTÓN y responde", sent2)
        seen_g = False
        t0 = time.time()
        while time.time() - t0 < 20:
            if ("Verde: recibido" in chat_log(guest)) or ("Green: recibido" in chat_log(guest)):
                seen_g = True
                break
            guest.wait_for_timeout(500)
        check("F3d) invitado ve «Verde/Green: …»", seen_g, f"log={chat_log(guest)!r}")

        # ---------- F3: voz LIVE + RMS real en ambos (prioritario) ----------
        print("== F4) voz bidireccional con tono (RMS) ==", flush=True)
        vh = vg = None
        t0 = time.time()
        while time.time() - t0 < 35:
            try:
                vh = host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet()")
                vg = guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet()")
            except Exception:
                pass
            if vh and vg and vh.get("st") == "live" and vg.get("st") == "live" \
                    and vh.get("remote", 0) >= 1 and vg.get("remote", 0) >= 1:
                break
            host.wait_for_timeout(700)
            guest.wait_for_timeout(700)
        check("F4a) mic LIVE y stream REMOTO en AMBOS lados",
              bool(vh and vg and vh.get("st") == "live" and vg.get("st") == "live"
                   and vh.get("remote", 0) >= 1 and vg.get("remote", 0) >= 1),
              f"host={vh} guest={vg}")
        rms_h = rms_of_remote(host)
        rms_g = rms_of_remote(guest)
        check("F4b) audio REAL del invitado llega al anfitrión (RMS del tono)",
              isinstance(rms_h, (int, float)) and rms_h > 0.003, f"rms={rms_h}")
        check("F4c) audio REAL del anfitrión llega al invitado (RMS del tono)",
              isinstance(rms_g, (int, float)) and rms_g > 0.003, f"rms={rms_g}")
        chip_h = probe(host, "(function(){var v=document.querySelector('[data-e=voice]'); return !!v && !v.classList.contains('hidden');})", tries=1, wait_ms=0)
        chip_g = probe(guest, "(function(){var v=document.querySelector('[data-e=voice]'); return !!v && !v.classList.contains('hidden');})", tries=1, wait_ms=0)
        check("F4d) chip de voz VISIBLE en ambos", bool(chip_h and chip_g))
        js_click(host, "[data-e=micBtn]")
        host.wait_for_timeout(800)
        vh2 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.voiceNet()", tries=1, wait_ms=0)
        check("F4e) el chip silencia el micrófono", bool(vh2 and vh2.get("st") == "muted"), f"st={vh2}")
        js_click(host, "[data-e=micBtn]")
        host.wait_for_timeout(600)

        # ---------- F4: bocadillo del ricachón en el INVITADO ----------
        print("== F5) bocadillos del ricachón por red ==", flush=True)
        said = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.richSay('¡Prueba de voz del ricachón!')", tries=1, wait_ms=0)
        check("F5a) el anfitrión dispara la frase", bool(said))
        rich_g = None
        t0 = time.time()
        while time.time() - t0 < 15:
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d and d.get("richSaid"):
                rich_g = d["richSaid"]
                break
            guest.wait_for_timeout(500)
        check("F5b) el INVITADO ve el bocadillo (frase replicada por red)",
              bool(rich_g), f"richSaid={rich_g!r}")

        # ---------- F5: anclas del invitado por red (pendiente T108) ----------
        print("== F6) anclas del invitado (armar por red + soltar mano) ==", flush=True)
        port0 = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()")
        for _attempt in range(3):
            bp = probe(guest, "window.__NS_GUEST_BPK && __NS_GUEST_BPK(1)")
            if not bp:
                guest.wait_for_timeout(1200)
                continue
            guest.mouse.click(bp["x"], bp["y"])
            guest.wait_for_timeout(1100)
            opened = probe(guest, "(function(){var b=document.querySelector('[data-e=bpk]'); return b && !b.classList.contains('hidden');})()", tries=1, wait_ms=0)
            if opened:
                js_click(guest, "[data-e=bpkSlot]")
                guest.wait_for_timeout(700)
                armed_now = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
                if armed_now and armed_now.get("armed") and armed_now["armed"][1]:
                    break
        armed = False
        p = None
        t0 = time.time()
        while time.time() - t0 < 15:
            p = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.portables()", tries=1, wait_ms=0)
            if p and p.get("armed") and p["armed"][1]:
                armed = True
                break
            host.wait_for_timeout(500)
        check("F6a) mochila del Rojo → anfitrión ARMA por red", armed, f"portables={p}")
        placed_now = False
        if armed:
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
        check("F6b) soltar mano (remoteDrag) → ancla clavada", placed_now,
              f"antes={port0 and len(port0.get('placed') or [])} ahora={p and p.get('placed')}")

        check("F6) 0 errores JS en ambas pestañas", not err_h and not err_g,
              f"host={err_h[:2]} guest={err_g[:2]}")
        browser_h.close()
        browser_g.close()
finally:
    srv.kill()

print(f"\nE2E T109: {'FALLOS: ' + ', '.join(FALLOS) if FALLOS else 'VERDE'}")
sys.exit(1 if FALLOS else 0)
