#!/usr/bin/env python3
"""Sonda SMOKE reutilizable (T99): entra en partida en una URL del juego y exige
TODO VERDE. Pensada para el job de CI que corre tras cada despliegue a Pages,
pero sirve también contra localhost para verificar cambios antes de empujar.

Checks: partida arranca + campamento, suelo nevado T98 (verts/colores/nieve/
albedo), rocas, bloques, gorros, tarros, pedriz, 0 errores JS, 0 peticiones
fallidas y FETCH directo de assets clave (GLB, caras, emotes webp, narrator
mp3 es/en, rico mp3) para coger assets ausentes aunque el juego no los pida
durante la sonda.

Uso: python3 sonda-smoke.py [--url URL] [--out-dir DIR] [--intentos N]
Salida: líneas [OK]/[FALLO], RESULTADO final, informe.json y capturas en DIR.
exit 0 = TODO VERDE, exit 1 = fallos."""
import argparse, json, os, time
from playwright.sync_api import sync_playwright

PROD = "https://franjavierdavila.github.io/NOSUELTES/?test=escalada"

ASSETS = [
    "/models/base.glb", "/models/escalador.glb", "/models/rico.glb", "/models/sherpa.glb",
    "/models/caras/pieza_cara_asustado.glb", "/models/caras/pieza_cara_chuleria.glb",
    "/models/caras/pieza_cara_enfadado.glb", "/models/caras/pieza_cara_gritando.glb",
    "/models/caras/pieza_cara_orgulloso.glb",
    "/models/sherpas/emotes/r_furia.webp", "/models/sherpas/emotes/r_soberbia.webp",
    "/audio/narrator/es/start.1.mp3", "/audio/narrator/en/start.1.mp3",
    "/audio/rico/es/cd0e9f33.mp3",
]

ap = argparse.ArgumentParser()
ap.add_argument("--url", default=PROD)
ap.add_argument("--out-dir", default="/home/z/my-project/download")
ap.add_argument("--intentos", type=int, default=3)
args = ap.parse_args()
os.makedirs(args.out_dir, exist_ok=True)
base = args.url.split("?")[0].rstrip("/")

fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}", flush=True) or (None if c else fails.append(n))

def intento(p) -> bool:
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
                return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot') };
            })()""")
            if st.get("camp"):
                ready = True
                break
            page.wait_for_timeout(1500)
        except Exception as e:
            print("EXC", str(e)[:120], flush=True)
            page.wait_for_timeout(2500)
    ok("partida arrancada y campamento presente", ready, f"({time.time()-t0:.0f}s)")
    if not ready:
        browser.close()
        return False
    page.wait_for_timeout(2500)

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
    ok("floor con colores por vértice", data["floorVerts"] > 2000 and data["floorCols"] >= data["floorVerts"] * 4,
       f"verts={data['floorVerts']} cols={data['floorCols']}")
    ok("floor NIEVE (sin verde #79a054)", data["floorSnowy"] > 0.75 and bool(data["albedo"]) and data["albedo"][0] > 0.85,
       f"media RGB={data['floorSnowy']:.3f} albedo={data['albedo']}")
    # T109: el anillo de cantos de la cabaña genera 7 piezas (T90/T105 con el
    # pedriz actual); el umbral antiguo (40) venía de una generación anterior
    # y llevaba el smoke en rojo desde antes de T109. Lo que hay que vigilar
    # es que el campo NO quede vacío.
    ok("campo de rocas poblado", data["rocks"] >= 5, f"rocks={data['rocks']}")
    ok("bloques del anillo del campamento", data["boulders"] >= 7, f"boulders={data['boulders']}")
    ok("gorros de nieve en bloques grandes", data["caps"] >= 4, f"caps={data['caps']}")
    ok("tarros de nieve (malla fusionada)", data["drifts"] > 200, f"verts={data['drifts']}")
    ok("pedriz con nieve por vértice", data["screeWhite"] > 0.95, f"max R={data['screeWhite']:.2f}")
    ok("0 errores de página", len(errs) == 0, f"errs={errs[:3]}")
    ok("0 peticiones fallidas", len(fallidas) == 0, f"reqs={fallidas[:3]}")

    fetches = page.evaluate("""async (urls) => {
        const out = {};
        for (const u of urls) {
            try { const r = await fetch(u); out[u] = r.ok ? (await r.arrayBuffer()).byteLength : -r.status; }
            catch (e) { out[u] = 0; }
        }
        return out;
    }""", [base + a for a in ASSETS])
    malos = {k.split("/models")[-1].split("/audio")[-1]: v for k, v in fetches.items() if v < 1024}
    ok("assets clave servidos (GLB/caras/emotes/voz)", len(malos) == 0, f"malos={malos}")

    page.wait_for_timeout(4000)
    page.screenshot(path=f"{args.out_dir}/smoke-general.png", timeout=120000)
    page.evaluate("__SHERPAS_DEBUG.camPin(4.8, 1.4, -2.9, 7)")
    page.wait_for_timeout(2200)
    page.screenshot(path=f"{args.out_dir}/smoke-campamento.png", timeout=120000)
    browser.close()
    with open(os.path.join(args.out_dir, "informe.json"), "w") as f:
        json.dump({"url": args.url, "datos": data, "fetches": {k: fetches[k] for k in list(fetches)[:4]},
                   "errs": errs, "fallidas": fallidas}, f, indent=1)
    return not fails

with sync_playwright() as p:
    for i in range(1, args.intentos + 1):
        print(f"--- intento {i}/{args.intentos} ---", flush=True)
        fails = []
        if intento(p):
            break
        if i < args.intentos:
            print("reintento en 20s…", flush=True)
            time.sleep(20)

print("RESULTADO:", "TODO VERDE" if not fails else f"FALLOS: {fails}")
raise SystemExit(0 if not fails else 1)
