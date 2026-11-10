#!/usr/bin/env python3
"""E2E T96 — RONDA DE FEEDBACK DEL JUGADOR (3 dictados):
  A) MOCHILA PULSABLE: al pasar el ratón sobre el OBJETO mochila el cursor es
     pointer (y el objeto se resalta con outline); el CLIC sobre ella ABRE el
     interior — aunque haya extremidades cerca (arbitraje: más cercano gana,
     empate → mano).
  B) RESCATE POR PULSACIONES: el sherpa colgado NO se recupera solo (sus
     controles inactivos: su propia tecla C no lo sube); el COMPAÑERO tira de
     la cuerda con SU tecla (N del rojo): cada golpe lo sube ~0,5 m y al
     tener un anclaje a su alcance recupera la posición erguida.
  C) BILLETES: el disparo de la sacudida sale hacia ARRIBA (vy > 0 para
     TODOS), el papel SIGUE vivo (nunca muere en el suelo) y vuela con el
     viento hasta salir de pantalla.
Sirve el build standalone en 3102 y guarda capturas en download/.
"""
import subprocess, time, json, sys, urllib.request

PORT = 3102
BASE = f"http://127.0.0.1:{PORT}"
fallos = []

def check(nombre, ok, detalle=""):
    print(("✓ " if ok else "✗ ") + nombre + (f" — {detalle}" if detalle else ""), flush=True)
    if not ok: fallos.append(nombre)

srv = subprocess.Popen(
    ["node", "/home/z/my-project/.next/standalone/server.js"],
    env={"PORT": str(PORT), "HOSTNAME": "127.0.0.1", "PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        # --- nivel arriba y sherpas asentados (4 anclajes) ---
        s = None
        t0 = time.time()
        while time.time() - t0 < 160:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        print(f"nivel arriba: bloques={s['bloques']} anclajes={s['anclajes']} estado={s['state']}", flush=True)

        # ============ A) MOCHILA: hover + outline + clic ============
        # el sherpa SE BALANCEA: re-apuntar en vivo hasta que el cursor sea
        # pointer sobre la mochila y clicar EN SEGUIDA (misma posición viva)
        abierta = None
        cur = ""
        for intento in range(12):
            z0 = page.evaluate("window.__PARED.sonda().mochilaZona[0]")
            if not z0:
                page.wait_for_timeout(300); continue
            page.mouse.move(z0["x"], z0["y"], steps=3)
            page.wait_for_timeout(140)
            cur = page.evaluate("window.__PARED.sonda().cursor")
            if cur == "pointer":
                page.screenshot(path="/home/z/my-project/download/t96-mochila-hover.png")
                page.mouse.down(); page.wait_for_timeout(40); page.mouse.up()
                page.wait_for_timeout(500)
                abierta = page.evaluate("window.__PARED.sonda().mochilaAbierta")
                break
            page.wait_for_timeout(250)
        check("A.hover cursor pointer sobre la mochila", cur == "pointer", f"cursor={cur!r}")
        check("A.clic mochila ABRE el interior", abierta == 0, f"mochilaAbierta={abierta}")
        if abierta == 0:
            page.screenshot(path="/home/z/my-project/download/t96-mochila-interior.png")
            page.mouse.move(640, 690, steps=4)
            page.mouse.down(); page.wait_for_timeout(40); page.mouse.up()
            page.wait_for_timeout(300)

        # ============ C) BILLETES: disparo ARRIBA + siempre presentes ============
        page.evaluate("window.__PARED.sacudir()")
        # muestreo por TIEMPO DE SIMULACIÓN (la sim corre detrás del reloj)
        m = page.evaluate("""async () => {
            const out = { vyMin: 99, vyMax: -99, alt0: -99, altMax: -99, vivos: 0, yMin: 99 };
            const t0 = window.__PARED.sonda().simT;
            while (window.__PARED.sonda().simT - t0 < 1.0) {
                const s = window.__PARED.sonda();
                if (s.billetesVy) {
                    out.vyMin = Math.min(out.vyMin, s.billetesVy[0]);
                    out.vyMax = Math.max(out.vyMax, s.billetesVy[1]);
                }
                await new Promise(r => setTimeout(r, 60));
            }
            return out;
        }""")
        check("C.disparo hacia ARRIBA (vy de TODOS > 0 en la salida)", m["vyMin"] > 0.4,
              f"vyMin={m['vyMin']} vyMax={m['vyMax']}")
        # el papel SIGUE vivo volando con el viento 6 s de sim sin sacudida nueva
        m2 = page.evaluate("""async () => {
            const t0 = window.__PARED.sonda().simT;
            let vivosMax = 0, altMax = -99, yMin = 99, vivosFin = 0;
            while (window.__PARED.sonda().simT - t0 < 6.0) {
                const s = window.__PARED.sonda();
                vivosMax = Math.max(vivosMax, s.billetes);
                altMax = Math.max(altMax, s.billetesAlt);
                if (s.billetesYMin < 99) yMin = Math.min(yMin, s.billetesYMin);
                vivosFin = s.billetes;
                await new Promise(r => setTimeout(r, 80));
            }
            return { vivosMax, altMax, yMin, vivosFin };
        }""")
        check("C.el papel ALCANA altura de fuegos (>= 3 m sobre la salida)", m2["altMax"] > 3.0,
              f"altMax={m2['altMax']}")
        check("C.el papel NUNCA bajo la nieve", m2["yMin"] > -0.05, f"yMin={m2['yMin']}")
        check("C.el papel SIGUE vivo volando (siempre presente; el suelo no mata)",
              m2["vivosFin"] > 0, f"vivosFin={m2['vivosFin']} vivosMax={m2['vivosMax']}")
        page.screenshot(path="/home/z/my-project/download/t96-billetes-viento.png")

        # ============ B) RESCATE POR PULSACIONES ============
        page.evaluate("window.__PARED.sueltaSherpa(0)")
        colgado = False
        for _ in range(60):
            s = page.evaluate("window.__PARED.sonda()")
            if s["ropeStates"][0] in ("caught", "hauling") and s["rescate"][0]["colgado"]:
                colgado = True; break
            page.wait_for_timeout(300)
        check("B.caída capturada: COLGADO sin recobro (controles inactivos)", colgado,
              f"ropeState={s['ropeStates'][0]} rescate={s['rescate']}")
        # el desplome tarda ~0,6 s de sim en asentar: esperar antes de medir la pose
        page.wait_for_timeout(2200)
        s = page.evaluate("window.__PARED.sonda()")
        page.screenshot(path="/home/z/my-project/download/t96-colgado-horizontal.png")
        desplome_colgado = s["desplome"][0]
        check("B.pose HORIZONTAL colgado (desplome lateral > 0,25 m — el pecho cruza al lado)",
              abs(desplome_colgado) > 0.25,
              f"desplome={desplome_colgado}")
        # 1) SU propia tecla (C) NO lo sube: controles inactivos
        m3 = page.evaluate("""async () => {
            const s0 = window.__PARED.sonda();
            const y0 = s0.alt0;
            for (let i = 0; i < 12; i++) {
                window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyC', bubbles: true}));
                await new Promise(r => setTimeout(r, 70));
                window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyC', bubbles: true}));
            }
            await new Promise(r => setTimeout(r, 1200));
            const s1 = window.__PARED.sonda();
            return { y0, y1: s1.alt0, colgado: s1.rescate[0].colgado, haul: s1.rescate[0].haulHecho };
        }""")
        check("B.su PROPIA tecla no lo sube (controles inactivos)",
              abs(m3["y1"] - m3["y0"]) < 0.35 and not m3["haul"],
              f"alt0 {m3['y0']}→{m3['y1']} haulHecho={m3['haul']}")
        # 2) la tecla del COMPAÑERO (N) lo sube a golpes de ~0,5 m
        m4 = page.evaluate("""async () => {
            const s0 = window.__PARED.sonda();
            const y0 = s0.alt0;
            let yMin = y0;
            for (let i = 0; i < 14; i++) {
                window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyN', bubbles: true}));
                await new Promise(r => setTimeout(r, 110));
                window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyN', bubbles: true}));
                yMin = Math.min(yMin, window.__PARED.sonda().alt0);
            }
            // espera a que el rescate lo incorpore
            let haul = false, yFin = y0, erguido = null;
            for (let i = 0; i < 60; i++) {
                const s = window.__PARED.sonda();
                haul = s.rescate[0].haulHecho;
                yFin = s.alt0;
                erguido = s.desplome[0];
                if (haul && s.ropeStates[0] === 'caught') break;
                await new Promise(r => setTimeout(r, 250));
            }
            return { y0, yMin, yFin, haul, erguido };
        }""")
        check("B.la tecla del COMPAÑERO lo SUBE (>= 0,6 m desde la línea)",
              m4["yFin"] > m4["yMin"] + 0.6, f"yMin={m4['yMin']} → yFin={m4['yFin']}")
        check("B.RESCATE completado: recobrado erguido y con controles de vuelta",
              m4["haul"] and abs(m4["erguido"]) < 0.25, f"haul={m4['haul']} desplome={m4['erguido']}")
        page.screenshot(path="/home/z/my-project/download/t96-rescatado-erguido.png")

        check("E2E sin errores JS", len(errores) == 0, "; ".join(errores[:3]))
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc()
    fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO T96 ==", flush=True)
if fallos:
    print(f"FALLOS ({len(fallos)}):", *fallos, sep="\n - ")
    sys.exit(1)
print("TODO VERDE")
