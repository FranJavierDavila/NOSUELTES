#!/usr/bin/env python3
"""T104 — captura del SUELO con camPin (vista del campamento y las losas)."""
import argparse, os, time

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:4173/NOSUELTES/")
ap.add_argument("--out-dir", default="/tmp/sonda-suelos6")
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
        if st and st.get("r") == 3 and st.get("vivo") and st.get("tiles", -1) >= 2:
            break
        page.wait_for_timeout(2000)
    print("partida viva + tiles:", page.evaluate("""(() => {
        const sc = __SHERPAS_DEBUG.sceneObj();
        return { tiles: sc.getBaseCampInfo().snowTiles, portada: !!document.querySelector('img[src*=cover], [data-a=go]') };
    })()"""), "errores:", errs[:3], flush=True)
    # vista del campamento: cámara clavada al suelo entre la cabaña y la pared
    page.evaluate("__SHERPAS_DEBUG.camPin(2.2, 0.4, 3.2, 9.5)")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{args.out_dir}/suelo-campamento-camPin.png", timeout=90000)
    # vista desde encima de la cabaña hacia la pared (sintonía GLB-GLB)
    page.evaluate("__SHERPAS_DEBUG.camPin(5.2, 0.3, -0.8, 7.0)")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{args.out_dir}/suelo-cabana-camPin.png", timeout=90000)
    page.evaluate("__SHERPAS_DEBUG.camPin(null)")
    browser.close()
print("OK capturas")
