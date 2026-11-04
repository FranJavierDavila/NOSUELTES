#!/usr/bin/env python3
"""E2E T110 — pantalla de carga (pico + barra + mensajes), humo EN la chimenea,
muro terracota, macizos con material paramétrico del muro, botones online en
MÓVIL (touch) y voz del ricachón en AMBOS jugadores (fichero viaja vf/vk).

Orden probado en T108/T109: sala + unión del invitado CON el anfitrión en el
panel (SwiftShader caduca los offers si el host ya está EN partida) → GO →
ambos dentro → capturas → voz por red.

F1 loader real · F2 campamento (chimenea/humo/macizos) · F3 sala+unión+GO ·
F4 partida (tono/humo/capturas) · F5 voz+bocadillo del ricachón en el
invitado · F6 móvil táctil (panel online completo) · F7 0 errores JS.
"""
import subprocess
import sys
import time

BASE = "http://127.0.0.1:3100/NOSUELTES"
CAPS = "/home/z/my-project/download/T110-capturas"
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


def wait_el(page, sel, timeout_s=150):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if page.evaluate(f"!!document.querySelector('{sel}')"):
                return
        except Exception:
            pass
        page.wait_for_timeout(300)
    raise TimeoutError(f"no apareció {sel}")


def js_click(page, sel, wait_ms=400):
    page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (e) e.click(); }})()")
    page.wait_for_timeout(wait_ms)


def snap(page, path, ms=60000):
    try:
        page.screenshot(path=path, timeout=ms)
    except Exception as e:
        print(f"  [diag] captura {path.rsplit('/',1)[-1]}: {type(e).__name__}")


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


import os
os.makedirs(CAPS, exist_ok=True)
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
        ctx_h = browser_h.new_context(viewport={"width": 760, "height": 520})
        ctx_h.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        host = ctx_h.new_page()
        err_h = []
        host.on("pageerror", lambda e: err_h.append(str(e)))

        # ---------- F1: pantalla de carga real ----------
        print("== F1) pantalla de carga (pico + barra + mensajes) ==", flush=True)
        host.goto(BASE, wait_until="domcontentloaded")
        load_seen = False
        t0 = time.time()
        while time.time() - t0 < 30:
            try:
                if host.evaluate("!!document.getElementById('ns-loading')"):
                    load_seen = True
                    break
            except Exception:
                pass
            host.wait_for_timeout(150)
        check("F1a) overlay de carga visible AL ARRANCAR", load_seen)
        if load_seen:
            host.wait_for_timeout(900)
            load_info = probe(host, """(() => {
              const r = document.getElementById('ns-loading'); if (!r) return null;
              return {
                pico: !!r.textContent.includes('⛏'),
                barra: !!r.querySelector('#ns-load-bar'),
                pct: (r.querySelector('#ns-load-pct')||{}).textContent || '',
                msg: (r.querySelector('#ns-load-msg')||{}).textContent || '',
              };
            })()""", tries=2)
            check("F1b) pico de sherpa + barra + %", bool(load_info and load_info.get("pico") and load_info.get("barra")), f"pct={load_info and load_info.get('pct')}")
            check("F1c) mensaje gracioso de escalada", bool(load_info and len(load_info.get("msg", "")) > 8), f"msg={load_info and load_info.get('msg')!r}")
            snap(host, f"{CAPS}/01-cargando.png")
        gone = False
        t0 = time.time()
        while time.time() - t0 < 170:
            try:
                if not host.evaluate("!!document.getElementById('ns-loading')"):
                    gone = True
                    break
            except Exception:
                pass
            host.wait_for_timeout(500)
        check("F1d) la carga TERMINA y descubre la pantalla (menú)", gone)

        # ---------- F2: campamento — chimenea/humo/macizos ----------
        print("== F2) campamento: chimenea, humo, macizos paramétricos ==", flush=True)
        bc = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp()", tries=6)
        check("F2a) cabaña texturizada (base_cabana.jpg)", bool(bc and bc.get("cabinTex")), f"bc={bc}")
        check("F2b) humo de chimenea ACTIVO", bool(bc and bc.get("smoke")), f"smoke={bc and bc.get('smoke')}")
        emitter = probe(host, """(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const pss = sc && sc.scene && sc.scene.particleSystems;
          if (!pss || !pss.length) return null;
          const ps = pss.find(p => p.name === 'chimenea') || pss[0];
          if (!ps || !ps.emitter) return null;
          const e = ps.emitter;
          return { name: ps.name, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2) };
        })()""", tries=4)
        # boca de chimenea esperada (3.81, ~5.1, −2.43) ± tolerancia
        ok_pos = bool(emitter and abs(emitter["x"] - 3.81) < 0.25 and abs(emitter["z"] + 2.43) < 0.3 and 4.5 < emitter["y"] < 5.6)
        check("F2c) emisor del humo EN LA BOCA de la chimenea (3.81,~5.1,−2.43)", ok_pos, f"emitter={emitter}")
        massif_mat = probe(host, """(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const m = sc && sc.scene && sc.scene.getMeshByName && sc.scene.getMeshByName('sideMassifs');
          return m && m.material ? m.material.name : null;
        })()""", tries=4)
        check("F2d) macizos laterales con material paramétrico del MURO", massif_mat == "massifRockM", f"mat={massif_mat}")
        check("F2e) triángulos de macizo generados", bool(bc and (bc.get("massifTris") or 0) > 500), f"tris={bc and bc.get('massifTris')}")

        # ---------- F3: sala + unión del invitado ANTES del GO ----------
        print("== F3) sala real + unión del invitado + GO ==", flush=True)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(host, "button[data-a=net]")
        wait_el(host, "[data-a=netHost]")
        js_click(host, "[data-a=netHost]")
        c0 = None
        t0 = time.time()
        while time.time() - t0 < 20:
            try:
                c0 = host.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
            except Exception:
                c0 = None
            if c0:
                break
            host.wait_for_timeout(400)
        check("F3a) sala creada en el anfitrión", bool(c0 and len(c0) == 4), f"código={c0!r}")

        browser_g = pw.chromium.launch(args=flags)
        ctx_g = browser_g.new_context(viewport={"width": 400, "height": 300})
        ctx_g.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        guest = ctx_g.new_page()
        err_g = []
        guest.on("pageerror", lambda e: err_g.append(str(e)))
        # SwiftShader (T86): viewport mínimo durante la unión → frames baratos
        # → la señalización WebRTC respira (artefacto del E2E, no del juego).
        host.set_viewport_size({"width": 200, "height": 150})
        guest.goto(BASE, wait_until="domcontentloaded")
        wait_el(guest, "button[data-a=net]", timeout_s=170)
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        js_click(guest, "button[data-a=net]")
        wait_el(guest, "[data-a=netCode]")
        guest.evaluate("""(code) => {
          const el = document.querySelector('[data-a=netCode]');
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(el, code);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }""", c0 or "BBBB")
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
        check("F3b) invitado real unido a la sala", joined)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        guest.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(false)")
        host.set_viewport_size({"width": 760, "height": 520})
        js_click(host, "[data-a=netGo]")  # GO del panel: publica sesión al guest
        gok = False
        t0 = time.time()
        while time.time() - t0 < 160:
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d and d.get("tick", 0) > 0:
                gok = True
                break
            guest.wait_for_timeout(900)
        check("F3c) invitado dentro de la partida (snapshots)", gok)
        host.wait_for_timeout(4000)

        # ---------- F4: partida — tono del muro, humo, capturas ----------
        print("== F4) partida: tono terracota + humo en vivo ==", flush=True)
        wm = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.wallMat()", tries=4)
        check("F4a) material del muro PBR + estratos activos", bool(wm and wm.get("albedo") and wm.get("bump") and wm.get("strata")), f"wm={wm}")
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(4.8, 2.2, -2.9, 14)")
        host.wait_for_timeout(3000)
        snap(host, f"{CAPS}/02-campamento-humo.png")
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(null)")
        host.wait_for_timeout(1500)
        snap(host, f"{CAPS}/03-partida-general.png")
        # color del muro DESDE LA CAPTURA (readPixels fuera del render = ceros)
        wall_rgb = None
        try:
            from PIL import Image
            im = Image.open(f"{CAPS}/03-partida-general.png").convert("RGB")
            w, h = im.size
            box = im.crop((int(w * 0.30), int(h * 0.25), int(w * 0.70), int(h * 0.60)))
            px = list(box.resize((24, 16)).getdata())
            n = len(px) or 1
            wall_rgb = {c: round(sum(p[i] for p in px) / n) for i, c in enumerate("rgb")}
        except Exception as e:
            print(f"  [diag] sonda color: {type(e).__name__}")
        if wall_rgb:
            rojizo = wall_rgb["r"] > wall_rgb["g"] > wall_rgb["b"] and wall_rgb["r"] - wall_rgb["b"] > 14
            check("F4b) muro con TONO ROJIZO (r>g>b, dominante cálida)", rojizo, f"rgb={wall_rgb} (piedras=#bd7e6e)")
        else:
            check("F4b) muro con TONO ROJIZO (sin captura)", False)

        # ---------- F5: voz del ricachón en AMBOS ----------
        print("== F5) voz del ricachón en ambos jugadores ==", flush=True)
        host.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('voz_red')")
        vh = None
        t0 = time.time()
        while time.time() - t0 < 12:
            vh = probe(host, "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.richVoice()", tries=1, wait_ms=0)
            if vh:
                break
            host.wait_for_timeout(400)
        check("F5a) ANFITRIÓN: voz real del banco sonando (fichero vivo)", bool(vh and vh.get("file")), f"voice={vh}")
        gv = 0
        t0 = time.time()
        while time.time() - t0 < 15:
            d = probe(guest, "window.__NS_GUEST && __NS_GUEST()", tries=1, wait_ms=0)
            if d:
                gv = d.get("richVoices", 0)
                if gv >= 1:
                    break
            guest.wait_for_timeout(500)
        check("F5b) INVITADO reproduce LA MISMA voz del ricachón (por red)", gv >= 1, f"richVoices={gv}")
        rich_g = probe(guest, "window.__NS_GUEST && __NS_GUEST() ? __NS_GUEST().richSaid : null", tries=3)
        check("F5c) bocadillo del ricachón sigue llegando al invitado", bool(rich_g), f"richSaid={rich_g!r}")

        # ---------- F6: MÓVIL táctil — panel online completo ----------
        print("== F6) móvil táctil: botones del modo online ==", flush=True)
        browser_m = pw.chromium.launch(args=flags)
        ctx_m = browser_m.new_context(
            viewport={"width": 390, "height": 740}, is_mobile=True, has_touch=True,
            device_scale_factor=2, user_agent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
        )
        ctx_m.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        mov = ctx_m.new_page()
        err_m = []
        mov.on("pageerror", lambda e: err_m.append(str(e)))
        mov.goto(BASE, wait_until="domcontentloaded")
        wait_el(mov, "button[data-a=net]", timeout_s=170)
        mov.wait_for_timeout(600)
        btn = mov.evaluate("""(() => {
          const b = document.querySelector('button[data-a=net]');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2,
                   under: (() => { const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? (e.tagName + '.' + (e.className || '')) : 'nada'; })() };
        })()""")
        print(f"  [diag] botón 'Jugar online' en móvil: {btn}", flush=True)
        if btn and btn.get("y", 0) > 0:
            mov.touchscreen.tap(btn["x"], btn["y"])
        mov.wait_for_timeout(900)
        panel_open = probe(mov, "(function(){var n=document.querySelector('[data-e=net]'); return !!n && !n.classList.contains('hidden');})", tries=3)
        check("F6a) TOQUE en «Jugar online» abre el panel", bool(panel_open))
        hbtn = mov.evaluate("""(() => {
          const b = document.querySelector('[data-a=netHost]');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()""")
        if hbtn and hbtn.get("y", 0) > 0:
            mov.touchscreen.tap(hbtn["x"], hbtn["y"])
        code_m = None
        t0 = time.time()
        while time.time() - t0 < 25:
            try:
                code_m = mov.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
            except Exception:
                code_m = None
            if code_m:
                break
            mov.wait_for_timeout(500)
        check("F6b) TOQUE en «Crear sala» crea la sala (código visible)", bool(code_m and len(code_m) == 4), f"code={code_m!r}")
        snap(mov, f"{CAPS}/04-movil-online.png", ms=20000)

        check("F7) 0 errores JS en las tres pestañas", not err_h and not err_g and not err_m,
              f"host={err_h[:2]} guest={err_g[:2]} móvil={err_m[:2]}")
        browser_h.close()
        browser_g.close()
        browser_m.close()
finally:
    srv.kill()

print(f"\nE2E T110: {'FALLOS: ' + ', '.join(FALLOS) if FALLOS else 'VERDE'}")
sys.exit(1 if FALLOS else 0)
