#!/usr/bin/env python3
"""T106 — captura del mosaico SIN aplanar y de cobertura completa.
Vistas: general, zona izquierda (marcada en rojo por el jugador), pie de pared
(franja z<−4 que antes quedaba sin parcelas) y a ras de suelo (volumen 3D)."""
import argparse, os, time

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://127.0.0.1:3100/NOSUELTES")
ap.add_argument("--out-dir", default="/tmp/sonda-mosaico")
args = ap.parse_args()
os.makedirs(args.out_dir, exist_ok=True)

from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    ctx = browser.new_context(viewport={"width": 1000, "height": 640})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.on("console", lambda m: (m.type == "error") and errs.append(f"[console] {m.text[:200]}"))
    page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    tiles = -1
    while time.time() - t0 < 300:
        st = page.evaluate("""(() => {
            if (!window.__SHERPAS_DEBUG) return { r: 0 };
            const sc = __SHERPAS_DEBUG.sceneObj();
            if (!sc || !sc.scene) return { r: 1 };
            const b = document.querySelector('button[data-a=go]');
            if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return { r: 2 }; }
            const vivo = !!(sc.puppet && sc.puppet[0]) || !!sc.richPuppet;
            return { r: 3, vivo, tiles: sc.getBaseCampInfo ? sc.getBaseCampInfo().snowTiles : -1 };
        })()""")
        if st and st.get("r") == 3 and st.get("vivo"):
            tiles = st.get("tiles", -1)
            if tiles >= 2:
                break
        page.wait_for_timeout(2000)
    print("partida viva; snowTiles:", tiles, "errores:", errs[:3], flush=True)
    views = [
        ("general", "2.6, 0.0, 3.0, 14.0"),        # panorama: todo el suelo enmosaicado
        ("cenital", "7.5, 0.0, 2.0, 24.0"),        # desde arriba: cobertura sin huecos
        ("zona-izquierda", "3.6, -13.5, 4.0, 9.0"), # la zona roja del jugador (x<−12)
        ("pie-pared", "1.2, -2.0, -8.0, 7.0"),      # franja junto al muro (z<−4)
        ("ras-suelo", "0.9, -3.0, 4.6, 8.0"),       # volumen 3D de las piedras
    ]
    for name, argsv in views:
        page.evaluate(f"__SHERPAS_DEBUG.camPin({argsv})")
        page.wait_for_timeout(9000)
        page.screenshot(path=f"{args.out_dir}/t106-{name}.png", timeout=90000)
        print("captura", name, flush=True)
    page.evaluate("__SHERPAS_DEBUG.camPin(null)")
    browser.close()
print("OK capturas T106; errores JS:", errs[:5])
