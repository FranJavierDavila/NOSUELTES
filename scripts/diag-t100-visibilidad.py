#!/usr/bin/env python3
"""Diagnóstico de VISIBILIDAD de los billetes (T100): sirve la exportación
estática out/, fuerza una sacudida con el cheat E2E y muestrea, en tiempo de
SIMULACIÓN, la posición de CADA billete proyectada a PÍXELES de pantalla con
la cámara real (projectToScreenCss). Cuantifica cuánto dura un billete a la
vista del jugador y captura pantallazos en t+0.5/2/4/8 s de sim.
Uso: python3 diag-t100-visibilidad.py <sufijo>   (p.ej. antes / despues)
Capturas: download/<sufijo>-t05.png, -t2.png, -t4.png, -t8.png
"""
import subprocess, time, sys, urllib.request

SUF = sys.argv[1] if len(sys.argv) > 1 else "antes"
PORT = 3112
BASE = f"http://127.0.0.1:{PORT}"
DL = "/home/z/my-project/download"

# la exportación usa rutas absolutas /NOSUELTES/_next/... → symlink espejo
subprocess.run(["ln", "-sfn", "/home/z/my-project/out", "/home/z/my-project/out/NOSUELTES"], check=True)

srv = subprocess.Popen(
    ["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory",
     "/home/z/my-project/out"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
for _ in range(40):
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
        print(f"nivel arriba: bloques={s['bloques']} estado={s['state']} bolsaY={s.get('bolsaY')}", flush=True)
        ref = page.evaluate("() => { const P = window.__PARED; return { waist: P.sherpas[0].waist().y }; }")
        print(f"cintura S0 = {ref['waist']:.2f}  (boca del saco = {s.get('bolsaY'):.2f})", flush=True)

        page.evaluate("window.__PARED.sacudir()")

        muestra = page.evaluate("""async () => {
            const P = window.__PARED;
            const enPx = (b) => {
                let px = null;
                try { px = P.d.scene.projectToScreenCss(b.pos); } catch (e) {}
                return px ? { x: Math.round(px.x), y: Math.round(px.y),
                              dy: +(b.pos.y - P.sonda().bolsaY).toFixed(2), vy: +b.vel.y.toFixed(2) } : null;
            };
            const dentro = (p) => p && p.x >= -20 && p.x <= 1300 && p.y >= -20 && p.y <= 740;
            const filas = [];
            const t0 = P.sonda().simT;
            const marcas = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12];
            let mi = 0;
            while (mi < marcas.length) {
                if (P.sonda().simT - t0 >= marcas[mi]) {
                    const s = P.sonda();
                    const det = (P.billetes || []).filter(b => b.vivo).map(enPx).filter(Boolean).slice(0, 6);
                    filas.push({ t: +(P.sonda().simT - t0).toFixed(1), vivos: s.billetes,
                                 enCuadro: det.filter(dentro).length, detalle: det });
                    mi++;
                }
                await new Promise(r => setTimeout(r, 60));
            }
            return filas;
        }""")
        print("\n== PROYECCIÓN A PANTALLA (1280×720) ==", flush=True)
        for f in muestra:
            print(f"t+{f['t']:>4} s | vivos={f['vivos']} EN CUADRO={f['enCuadro']} | " +
                  " ".join(f"[{b['x']},{b['y']}px Δy+{b['dy']} vy{b['vy']}]" for b in f["detalle"]), flush=True)

        print("\n== CAPTURAS (sacudida FRESCA: se re-lanza justo antes) ==", flush=True)
        page.evaluate("window.__PARED.sacudir()")  # T100fix: capturas del lanzamiento fresco, no del vuelo viejo
        t_shake = page.evaluate("window.__PARED.sonda().simT")
        for marca, nombre in [(0.5, "05"), (2, "2"), (4, "4"), (8, "8")]:
            page.evaluate("""async (target) => {
                const P = window.__PARED;
                while (P.sonda().simT < target) await new Promise(r => setTimeout(r, 50));
            }""", t_shake + marca)
            page.screenshot(path=f"{DL}/{SUF}-t{nombre}.png")
            print(f"captura t+{marca} s", flush=True)

        print(f"\nerrores JS: {errores[:3] if errores else 'ninguno'}", flush=True)
        browser.close()
except Exception:
    import traceback; traceback.print_exc()
finally:
    srv.terminate()

print("\n== FIN DIAG VISIBILIDAD ==")
