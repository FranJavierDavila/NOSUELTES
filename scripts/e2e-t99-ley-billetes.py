#!/usr/bin/env python3
"""E2E T99 — LEY ABSOLUTA DE LOS BILLETES (dictado del jugador):
  «el saco lanza billetes SOLO hacia arriba de forma aleatoria y los
   billetes vuelan flotando por el aire hasta que son cogidos... los
   billetes son lanzados hacia arriba, hacia la cumbre y NUNCA por debajo
   del saco. Es ley: los billetes vuelan lanzados hacia arriba».
Comprueba EN VIVO (build producción, puerto 3103):
  L1. DISPARO: la velocidad vertical de TODOS los billetes es > 0 al salir.
  L2. LEY EN VUELO: en ningún muestreo existe un billete vivo por debajo de
      la boca del saco (billetesBajoSaco === 0 siempre).
  L3. FLOTACIÓN: tras la pólvora siguen VIVOS flotando (siempre presentes)
      y la cota máxima sube (van hacia la cumbre).
  L4. SEGUNDA sacudida: relanzamiento aleatorio también 100 % hacia arriba.
Capturas en download/t99-*.png.
"""
import subprocess, time, sys, urllib.request

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

        s = None
        t0 = time.time()
        while time.time() - t0 < 160:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        print(f"nivel arriba: bloques={s['bloques']} anclajes={s['anclajes']} estado={s['state']} bolsaY={s.get('bolsaY')}", flush=True)
        check("0. cero billetes al arrancar", s["billetes"] == 0, f"billetes={s['billetes']}")

        # ============ L1-L3: PRIMERA SACUDIDA ============
        page.evaluate("window.__PARED.sacudir()")
        m = page.evaluate("""async () => {
            const out = { vyMin: 99, vyMax: -99, bajoSacoMax: 0, alt0: -99, altMax: -99,
                          yMinSobreSaco: 99, vivosMax: 0, vivosFin: 0, muestras: 0, n0: 0 };
            const t0 = window.__PARED.sonda().simT;
            let primera = true;
            while (window.__PARED.sonda().simT - t0 < 8.0) {
                const s = window.__PARED.sonda();
                if (s.billetesVy) {
                    if (primera) { out.n0 = s.billetes; out.alt0 = s.billetesAlt; primera = false; }
                    out.vyMin = Math.min(out.vyMin, s.billetesVy[0]);
                    out.vyMax = Math.max(out.vyMax, s.billetesVy[1]);
                    out.bajoSacoMax = Math.max(out.bajoSacoMax, s.billetesBajoSaco);
                    out.altMax = Math.max(out.altMax, s.billetesAlt);
                    if (s.billetesYMin < 99 && s.bolsaY > -90) {
                        out.yMinSobreSaco = Math.min(out.yMinSobreSaco, s.billetesYMin - s.bolsaY);
                    }
                    out.vivosMax = Math.max(out.vivosMax, s.billetes);
                    out.vivosFin = s.billetes;
                    out.muestras++;
                }
                await new Promise(r => setTimeout(r, 70));
            }
            return out;
        }""")
        print(f"m1: {m}", flush=True)
        check("L1.disparo hacia ARRIBA (vy de TODOS > 0)", m["n0"] >= 3 and m["vyMin"] > 0.4,
              f"n0={m['n0']} vyMin={m['vyMin']} vyMax={m['vyMax']}")
        check("L2.LEY DEL SACO: cero billetes bajo la boca en TODO el vuelo",
              m["bajoSacoMax"] == 0 and m["yMinSobreSaco"] > -0.02,
              f"bajoSacoMax={m['bajoSacoMax']} yMin−bolsaY={m['yMinSobreSaco']:.2f}")
        check("L3.flotación: suben hacia la cumbre (altMax > alt0 + 2 m)",
              m["altMax"] > m["alt0"] + 2.0, f"alt0={m['alt0']:.2f} altMax={m['altMax']:.2f}")
        check("L3.siempre presentes flotando (vivos tras 8 s de sim)",
              m["vivosFin"] > 0, f"vivosMax={m['vivosMax']} vivosFin={m['vivosFin']}")
        page.screenshot(path="/home/z/my-project/download/t99-billetes-ascendiendo.png")

        # ============ L4: SEGUNDA SACUDIDA (aleatoriedad) ============
        page.evaluate("window.__PARED.sacudir()")
        m2 = page.evaluate("""async () => {
            const out = { vyMin: 99, bajoSacoMax: 0, n0: 0, muestras: 0 };
            const t0 = window.__PARED.sonda().simT;
            let primera = true;
            while (window.__PARED.sonda().simT - t0 < 3.0) {
                const s = window.__PARED.sonda();
                if (s.billetesVy) {
                    if (primera) { out.n0 = s.billetes; primera = false; }
                    out.vyMin = Math.min(out.vyMin, s.billetesVy[0]);
                    out.bajoSacoMax = Math.max(out.bajoSacoMax, s.billetesBajoSaco);
                    out.muestras++;
                }
                await new Promise(r => setTimeout(r, 70));
            }
            return out;
        }""")
        print(f"m2: {m2}", flush=True)
        check("L4.segunda sacudida: relanzamiento aleatorio TAMBIÉN 100 % hacia arriba y sobre el saco",
              m2["vyMin"] > 0.4 and m2["bajoSacoMax"] == 0 and m2["n0"] > m["vivosFin"],
              f"n0={m2['n0']} vyMin={m2['vyMin']} bajoSacoMax={m2['bajoSacoMax']}")
        page.screenshot(path="/home/z/my-project/download/t99-segunda-sacudida.png")

        check("E2E sin errores JS", len(errores) == 0, "; ".join(errores[:3]))
        browser.close()
except Exception as e:
    import traceback; traceback.print_exc()
    fallos.append(f"excepción: {e}")
finally:
    srv.terminate()

print("\n== RESULTADO T99 ==", flush=True)
if fallos:
    print(f"FALLOS ({len(fallos)}):", *fallos, sep="\n - ")
    sys.exit(1)
print("TODO VERDE — LA LEY SE CUMPLE")
