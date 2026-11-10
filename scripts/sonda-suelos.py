#!/usr/bin/env python3
"""T104 — SONDA VISUAL de los suelos nevados GLB + sherpa rojo:
arranca partida (flujo T101 probado), espera campamento + tiles y captura
pantallas. Uso: python3 scripts/sonda-suelos.py [--url URL] [--out-dir DIR]"""
import argparse, os, time

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:4173/NOSUELTES/")
ap.add_argument("--out-dir", default="/tmp/sonda-suelos")
args = ap.parse_args()
os.makedirs(args.out_dir, exist_ok=True)

from playwright.sync_api import sync_playwright

checks = []

def ok(nombre, cond, detalle=""):
    checks.append((bool(cond), nombre))
    print(f"  [{'OK ' if cond else 'FALLO'}] {nombre} {detalle}", flush=True)

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
    page.on("pageerror", lambda e: errs.append(str(e)[:160]))
    page.on("console", lambda m: (m.type in ("warning", "error")) and errs.append(f"[{m.type}] {m.text[:160]}"))
    page.on("requestfailed", lambda r: errs.append(f"[req] {r.url[-60:]} {r.failure}"))
    glb_reqs = []
    page.on("response", lambda r: ("suelonevado" in r.url or "base.glb" in r.url) and glb_reqs.append(f"{r.url[-40:]} → {r.status}"))

    print(f"== abriendo {args.url} ==", flush=True)
    page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    ready = False
    while time.time() - t0 < 300:
        try:
            st = page.evaluate("""(() => {
                if (!window.__SHERPAS_DEBUG) return { debug: false };
                const sc = __SHERPAS_DEBUG.sceneObj();
                if (!sc || !sc.scene) return { debug: true };
                const b = document.querySelector('button[data-a=go]');
                if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return { debug: true, clicked: true }; }
                return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot'),
                         rich: !!sc.richPuppet, p0: !!(sc.puppet && sc.puppet[0]) };
            })()""")
            if st.get("camp") and st.get("rich") and st.get("p0"):
                ready = True
                break
            page.wait_for_timeout(1500)
        except Exception:
            page.wait_for_timeout(1500)
    ok("partida arrancada y campamento presente", ready, f"{round(time.time() - t0)}s")

    info = None
    t1 = time.time()
    while time.time() - t1 < 150:
        page.wait_for_timeout(5000)
        info = page.evaluate("""(() => {
            const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
            if (!sc || !sc.getBaseCampInfo) return null;
            return sc.getBaseCampInfo();
        })()""")
        if info and info.get("snowTiles", 0) >= 2:
            break
    ok("2 tiles de suelo nevado cargados (sonda snowTiles)",
       bool(info) and info.get("snowTiles", 0) >= 2, f"snowTiles={info and info.get('snowTiles')}")
    nodos = page.evaluate("""(() => {
        const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
        if (!sc || !sc.scene) return null;
        return {
            glbReq: null,
            roots: sc.scene.rootNodes.slice(0, 40).map((n) => n.name || '?').filter((n) => n.includes('snow') || n.includes('base') || n.includes('Suelo')),
            meshes: sc.scene.meshes.map((m) => m.name).filter((n) => n.toLowerCase().includes('suelo') || n.toLowerCase().includes('snow')),
        };
    })()""")
    print("  nodos/meshes de nieve:", nodos, flush=True)
    print("  peticiones GLB:", glb_reqs, flush=True)
    page.wait_for_timeout(8000)
    page.screenshot(path=f"{args.out_dir}/suelos-campamento.png", timeout=90000)
    page.wait_for_timeout(8000)
    page.screenshot(path=f"{args.out_dir}/suelos-campamento-b.png", timeout=90000)
    ok("sin errores JS", not errs, f"errs={errs[:2]}")
    browser.close()

fallos = [n for okk, n in checks if not okk]
print("RESULTADO:", "TODO VERDE" if not fallos else f"CON FALLOS: {fallos}")
