#!/usr/bin/env python3
"""Sonda E2E de la WEB EN VIVO (GitHub Pages) tras el deploy de T98.
Mismos checks que sonda-t98.py pero contra la URL pública:
suelo nevado por vértice, rocas, anillo de bloques, gorros, tarros + capturas."""
import time
from playwright.sync_api import sync_playwright

URL = "https://franjavierdavila.github.io/NOSUELTES/?test=escalada"
OUT = "/home/z/my-project/download"

fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}", flush=True) or (None if c else fails.append(n))

with sync_playwright() as p:
    browser = p.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        "--enable-unsafe-swiftshader",
    ])
    ctx = browser.new_context(viewport={"width": 1000, "height": 500})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs: list[str] = []
    page.on("pageerror", lambda e: errs.append(str(e)[:160]))
    fallidas: list[str] = []
    page.on("requestfailed", lambda r: fallidas.append(f"{r.failure} {r.url[:110]}"))

    print("== abriendo", URL, "==", flush=True)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
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
                return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot') };
            })()""")
            if st.get("camp"):
                ready = True
                break
            page.wait_for_timeout(1500)
        except Exception as e:
            print("EXC", str(e)[:120], flush=True)
            page.wait_for_timeout(2500)
    ok("partida arrancada en la web en vivo y campamento presente", ready,
       f"({time.time()-t0:.0f}s)")
    if not ready:
        raise SystemExit(1)
    page.wait_for_timeout(2500)

    print("== T98 en producción (GitHub Pages) ==", flush=True)
    data = page.evaluate("""(() => {
        const sc = __SHERPAS_DEBUG.sceneObj();
        const s = sc.scene;
        const floor = s.getMeshByName('floor');
        const fc = floor ? (floor.getVerticesData('color') || []) : [];
        const mat = s.getMaterialByName('snowFloor');
        const drifts = s.getMeshByName('snowDrifts');
        const capMaster = s.getMeshByName('snowCapM'); const caps = capMaster ? capMaster.instances.length : 0;
        const boulders = s.meshes.filter(m => m.name && m.name.startsWith('campBoulder')).length;
        const scree = s.getMeshByName('screeFloor');
        const screeCol = scree ? (scree.getVerticesData('color') || []) : [];
        const alb = mat && mat.albedoColor ? [mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b] : null;
        return {
            floorVerts: floor ? floor.getTotalVertices() : 0,
            floorCols: fc.length,
            floorSnowy: fc.length ? fc.reduce((a, v) => a + v, 0) / fc.length : 0,
            albedo: alb,
            rocks: sc.baseCampStats ? sc.baseCampStats.rocks : -1,
            drifts: drifts ? drifts.getTotalVertices() : 0,
            caps, boulders,
            screeWhite: screeCol.length ? Math.max(...screeCol.filter((_, i) => i % 4 === 0)) : 0,
        };
    })()""")
    print("   datos:", data, flush=True)
    ok("floor con colores por vértice (subdividido)", data["floorVerts"] > 2000 and data["floorCols"] >= data["floorVerts"] * 4,
       f"verts={data['floorVerts']} cols={data['floorCols']}")
    ok("floor NIEVE (sin verde #79a054)", data["floorSnowy"] > 0.75 and data["albedo"] and data["albedo"][0] > 0.85,
       f"media RGB={data['floorSnowy']:.3f} albedo={data['albedo']}")
    ok("campo de rocas poblado (pedriz + anillo cabaña)", data["rocks"] >= 40, f"rocks={data['rocks']}")
    ok("bloques del anillo del campamento", data["boulders"] >= 7, f"boulders={data['boulders']}")
    ok("gorros de nieve en bloques grandes", data["caps"] >= 4, f"caps={data['caps']}")
    ok("tarros de nieve (malla fusionada)", data["drifts"] > 200, f"verts={data['drifts']}")
    ok("pedriz con nieve por vértice (T98)", data["screeWhite"] > 0.95, f"max R={data['screeWhite']:.2f}")
    ok("0 errores de página", len(errs) == 0, f"errs={errs[:3]}")
    ok("0 peticiones fallidas", len(fallidas) == 0, f"reqs={fallidas[:3]}")

    page.wait_for_timeout(4000)
    page.screenshot(path=f"{OUT}/live-t98-general.png", timeout=120000)
    page.evaluate("__SHERPAS_DEBUG.camPin(4.8, 1.4, -2.9, 7)")
    page.wait_for_timeout(2200)
    page.screenshot(path=f"{OUT}/live-t98-campamento.png", timeout=120000)
    print("capturas guardadas", flush=True)
    browser.close()

print("RESULTADO:", "TODO VERDE" if not fails else f"FALLOS: {fails}")
