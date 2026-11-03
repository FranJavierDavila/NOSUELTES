#!/usr/bin/env python3
"""T98 — INTEGRACIÓN ESTÉTICA (suelo alpino nevado + hielo + piedra familia
cabaña). Sonda E2E sobre build de producción (puerto 3117):
 · floor con COLORES POR VÉRTICE (nada de verde #79a054): albedo casi blanco.
 · baseCampStats.rocks >= 40 (pedriz + anillo de bloques del campamento).
 · malla snowDrifts (tarros de nieve) + gorros de nieve instanciados.
 · 0 errores JS + capturas: general, campamento y suelo a ras."""
import functools
import http.server
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

BASE = "http://localhost:3117"
OUT = "/tmp/render"


def _kill_stale():
    for pat in ["[s]tandalone/server.js", "[n]ext-server", "[b]un.*standalone"]:
        subprocess.run(["pkill", "-f", pat], capture_output=True)
    time.sleep(1.2)


def start_server():
    env = dict(os.environ, NODE_ENV="production", PORT="3117", HOSTNAME="127.0.0.1")
    proc = subprocess.Popen(["bun", ".next/standalone/server.js"], cwd="/home/z/my-project",
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE, timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise RuntimeError("el servidor standalone no arrancó")


import os  # noqa: E402 (tras definir helpers, igual que la sonda T93)

class TS(socketserver.TCPServer):
    allow_reuse_address = True


Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project")
httpd = TS(("127.0.0.1", 3199), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

_kill_stale()
server = start_server()
fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}", flush=True) or (None if c else fails.append(n))

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        ctx = browser.new_context(viewport={"width": 1000, "height": 500})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(str(e)[:160]))
        cons: list[str] = []
        page.on("console", lambda m: cons.append(m.text[:160]))

        print("== arranque (modo test) ==", flush=True)
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        t0 = time.time()
        ready = False
        while time.time() - t0 < 240:
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
        ok("partida arrancada y campamento presente", ready)
        if not ready:
            raise RuntimeError("sin escena no hay verificación")
        page.wait_for_timeout(2500)  # asentar escena

        # ---------- T98: datos de integración ----------
        print("== T98 integración estética ==", flush=True)
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
                screeVerts: scree ? scree.getTotalVertices() : 0,
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

        # capturas: general, campamento (cabaña+anillo+tarros), suelo a ras
        page.wait_for_timeout(4000)
        page.screenshot(path=f"{OUT}/t98-general.png", timeout=120000)
        page.evaluate("__SHERPAS_DEBUG.camPin(4.8, 1.4, -2.9, 7)")
        page.wait_for_timeout(2200)
        page.screenshot(path=f"{OUT}/t98-campamento.png", timeout=120000)
        page.evaluate("__SHERPAS_DEBUG.camPin(0, 0.7, -4.2, 5.5)")
        page.wait_for_timeout(2200)
        page.screenshot(path=f"{OUT}/t98-suelo.png", timeout=120000)
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")

        ok("0 errores JS", len(errs) == 0, f"errs={errs[:2]} cons={len(cons)}")
        browser.close()
finally:
    server.kill()
    httpd.shutdown()

print("\n== RESUMEN T98 ==", flush=True)
if fails:
    print("FALLOS:", fails, flush=True)
    sys.exit(1)
print("TODO VERDE", flush=True)
