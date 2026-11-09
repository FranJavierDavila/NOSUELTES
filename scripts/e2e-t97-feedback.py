#!/usr/bin/env python3
"""E2E T97 — RONDA DE FEEDBACK DEL JUGADOR (capturas + dictados):
  A) BILLETES: CERO al arrancar (dictado: «nada más empezar, sin hacer
     absolutamente nada, lanza billetes hacia abajo») — 8 s de sim sin tocar
     nada: ni un billete, ni una sacudida (la rabieta ya no suelta papel).
  B) SACO SIN GIRO EN REPOSO (dictado: «no tiene sentido que realice un giro
     oscilante sobre su eje vertical sin más»): rotY/rotZ estables sin rabieta.
  C) SACO DE CARA (dictado: «el saco está espejado»): captura de cerca del $.
  D) CUERDA REAL (dictado: «descienda por gravedad hasta TODO el largo, en la
     perpendicular del compañero»): colgado a distancia ≈ cuerdaMetros DEBAJO
     del compañero anclado, en su línea de plomo, sin recobrarse solo.
  E) PARTIDA PERDIDA (dictado: «el juego está bloqueado, no da partida
     perdida»): el compañero cae a la nieve → panel ¡PARTIDA PERDIDA!.
Sirve el build standalone en 3103 y guarda capturas en download/.
"""
import subprocess, time, json, sys, urllib.request

PORT = 3103
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
        print(f"nivel arriba: bloques={s['bloques']} anclajes={s['anclajes']} estado={s['state']} cuerda={s['cuerda']}", flush=True)

        # ============ A) CERO BILLETES AL ARRANCAR (sin tocar nada) ============
        m = page.evaluate("""async () => {
            const out = { maxBilletes: 0, sacudidas0: -1, sacudidasMax: -1, muestras: 0 };
            const t0 = window.__PARED.sonda().simT;
            out.sacudidas0 = window.__PARED.sonda().sacudidas;
            while (window.__PARED.sonda().simT - t0 < 8.0) {
                const s = window.__PARED.sonda();
                out.maxBilletes = Math.max(out.maxBilletes, s.billetes);
                out.sacudidasMax = Math.max(out.sacudidasMax, s.sacudidas - out.sacudidas0);
                out.muestras++;
                await new Promise(r => setTimeout(r, 250));
            }
            return out;
        }""")
        check("A.nada más empezar CERO billetes (8 s de sim sin tocar nada)",
              m["maxBilletes"] == 0, f"maxBilletes={m['maxBilletes']} muestras={m['muestras']}")
        check("A.CERO sacudidas sin acción del jugador (la rabieta ya no suelta papel)",
              m["sacudidasMax"] == 0, f"sacudidas nuevas={m['sacudidasMax']}")
        page.screenshot(path="/home/z/my-project/download/t97-inicio.png")

        # ============ B) SACO SIN GIRO EN REPOSO ============
        m2 = page.evaluate("""async () => {
            const out = { rotYmin: 99, rotYmax: -99, rotZmax: 0, muestras: 0 };
            const t0 = window.__PARED.sonda().simT;
            while (window.__PARED.sonda().simT - t0 < 5.0) {
                const s = window.__PARED.sonda();
                if (s.rabieta < 0.02) {  // fuera el temblor REAL de la rabieta
                    out.rotYmin = Math.min(out.rotYmin, s.bolsaRotY);
                    out.rotYmax = Math.max(out.rotYmax, s.bolsaRotY);
                    out.rotZmax = Math.max(out.rotZmax, Math.abs(s.bolsaRotZ));
                    out.muestras++;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            return out;
        }""")
        check("B.el saco NO gira oscilando en reposo (rotY estable sin rabieta)",
              m2["muestras"] > 8 and (m2["rotYmax"] - m2["rotYmin"]) < 0.06,
              f"ΔrotY={m2['rotYmax'] - m2['rotYmin']:.4f} muestras={m2['muestras']}")
        check("B.el saco NO cabecea en reposo (rotZ ≈ 0 sin rabieta)",
              m2["rotZmax"] <= 0.011, f"rotZmax={m2['rotZmax']}")

        # ============ C) EL SACO DE CARA (no espejado) ============
        page.screenshot(path="/home/z/my-project/download/t97-saco.png")

        # ============ D) CUERDA REAL: colgado en la PERPENDICULAR ============
        # cuerda corta (2 m) para que el plomo bajo el compañero (cinturas en
        # la banda de arranque) quede FUERA de la banda de nieve — con la
        # cuerda de 5 por defecto el plomo toca la nieve y cae a tierra (T79,
        # física correcta también).
        page.evaluate("window.__PARED.setAjusteEnVivo('cuerdaMetros', 2)")
        page.wait_for_timeout(600)
        page.evaluate("window.__PARED.sueltaSherpa(0)")
        colgado = False
        for _ in range(60):
            s = page.evaluate("window.__PARED.sonda()")
            if s["ropeStates"][0] in ("caught", "hauling"):
                colgado = True; break
            page.wait_for_timeout(300)
        check("D.caída capturada por la CUERDA REAL (colgado)", colgado,
              f"ropeState={s['ropeStates'][0]}")
        page.wait_for_timeout(2600)  # el péndulo se apaga (~2,5 s)
        s = page.evaluate("window.__PARED.sonda()")
        import math
        dist = math.hypot(s["x0"] - s["x1"], s["alt0"] - s["alt1"])
        L = s["cuerda"]
        check("D.cuelga a TODO EL LARGO de la cuerda (dist ≈ L, no flotando arriba)",
              L - 0.45 <= dist <= L + 0.45, f"dist={dist:.2f} L={L}")
        check("D.cuelga DEBAJO del compañero (perpendicular/plomo)",
              (s["alt1"] - s["alt0"]) > 1.0 and abs(s["x0"] - s["x1"]) < 0.55,
              f"Δalt={s['alt1'] - s['alt0']:.2f} Δx={abs(s['x0'] - s['x1']):.2f}")
        check("D.sin rescate sigue COLGADO e inactivo (no se recupera solo)",
              s["ropeStates"][0] in ("caught", "hauling") and not s["rescate"][0]["haulHecho"],
              f"estado={s['ropeStates'][0]} haulHecho={s['rescate'][0]['haulHecho']}")
        page.screenshot(path="/home/z/my-project/download/t97-colgado-plomo.png")

        # ============ E) PARTIDA PERDIDA (el otro cae a la nieve) ============
        page.evaluate("window.__PARED.sueltaSherpa(1)")
        panel = None
        for _ in range(60):
            panel = page.evaluate("""(() => {
                const el = document.getElementById('pared-fin');
                return el ? { visible: !el.classList.contains('hidden') ?? true, texto: el.textContent || '' } : null;
            })()""")
            if panel and panel.get("texto") and "PARTIDA PERDIDA" in panel["texto"].upper():
                break
            page.wait_for_timeout(400)
        check("E.ambos fuera de acción → panel de derrota (NO bloqueo silencioso)",
              panel is not None and "PARTIDA PERDIDA" in panel["texto"].upper(),
              f"panel={'sí' if panel else 'no'}")
        page.screenshot(path="/home/z/my-project/download/t97-partida-perdida.png")

        check("E2E sin errores JS", len(errores) == 0, "; ".join(errores[:3]))
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc()
    fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO T97 ==", flush=True)
if fallos:
    print(f"FALLOS ({len(fallos)}):", *fallos, sep="\n - ")
    sys.exit(1)
print("TODO VERDE")
