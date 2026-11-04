#!/usr/bin/env python3
"""T105 — captura del MOSAICO de parcelas nevadas (escala 1/10, damero)."""
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
    # vista general del campamento: el damero debe cubrir el suelo visible
    page.evaluate("__SHERPAS_DEBUG.camPin(2.2, 0.5, 3.4, 9.0)")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{args.out_dir}/mosaico-campamento.png", timeout=90000)
    # a ras de suelo: las piedras de las parcelas sobresalen sobre la nieve
    page.evaluate("__SHERPAS_DEBUG.camPin(-3.0, 0.35, 4.6, 10.5)")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{args.out_dir}/mosaico-ras-suelo.png", timeout=90000)
    # pie de pared: la retícula llega hasta la pedriz
    page.evaluate("__SHERPAS_DEBUG.camPin(0.4, 0.45, -1.6, 6.5)")
    page.wait_for_timeout(9000)
    page.screenshot(path=f"{args.out_dir}/mosaico-pie-pared.png", timeout=90000)
    page.evaluate("__SHERPAS_DEBUG.camPin(null)")
    browser.close()
print("OK capturas mosaico")
