#!/usr/bin/env python3
"""T93-T97 — sonda E2E única sobre build de producción (puerto 3117):
 · T93 campamento pegado a la pared y EN CUADRO (proyección + capturas).
 · T95 qué mallas hay bajo el Ricachón (vuelco de AABB + captura a ras de tabla).
 · T97 fuerza boxes_fell → furia + bocadillo con la TRANSCRIPCIÓN del fichero.
 · T96 las 5 caras activan cabeza oculta + cara visible (pin por ánimo).
 · T94 el minimapa desaparece en viewport de móvil (táctil) y ventana estrecha."""
import functools
import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request

BASE = "http://localhost:3117"
OUT = "/tmp/render"
os.makedirs(OUT, exist_ok=True)


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


class TS(socketserver.TCPServer):
    allow_reuse_address = True


Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project")
httpd = TS(("127.0.0.1", 3199), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

_kill_stale()
server = start_server()
fails: list[str] = []
ok = lambda n, c, d="": print(f"  [{'OK ' if c else 'FALLO'}] {n} {d}", flush=True) or (None if c else fails.append(n))

JS_SEATED = """(() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })()"""

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

        print("== arranque (modo test: sin fatiga) ==", flush=True)
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        t0 = time.time()
        seated = False
        while time.time() - t0 < 240:
            try:
                st = page.evaluate("""(() => ({
                    debug: !!window.__SHERPAS_DEBUG,
                    go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                    seated: """ + JS_SEATED + """,
                }))()""")
                if st.get("seated"):
                    seated = True
                    break
                if not st.get("debug"):
                    page.wait_for_timeout(1500)
                    continue
                if st.get("go"):
                    page.evaluate("document.querySelector('button[data-a=go]').click()")
                print(f"[{time.time()-t0:5.1f}s] esperando sentado…", flush=True)
                page.wait_for_timeout(1500)
            except Exception as e:
                print("EXC", str(e)[:120], flush=True)
                page.wait_for_timeout(2500)
        ok("partida arrancada y ricachón sentado", seated)
        if not seated:
            raise RuntimeError("sin partida no hay verificación")

        page.wait_for_timeout(2000)  # asentar escena

        # ---------- T93: campamento pegado a la pared y EN CUADRO ----------
        print("== T93 campamento ==", flush=True)
        camp = None
        t1 = time.time()
        while time.time() - t1 < 40:
            camp = page.evaluate("""(() => {
                const sc = __SHERPAS_DEBUG.sceneObj();
                const root = sc.scene.getNodeByName('baseCampRoot');
                if (!root) return null;
                const p = root.position, s = root.scaling.x;
                const proj = __SHERPAS_DEBUG.project(p.x, 1.5, p.z);
                return { x: p.x, y: p.y, z: p.z, scale: s, proj, vw: sc.engine.getRenderWidth(), vh: sc.engine.getRenderHeight() };
            })()""")
            if camp:
                break
            page.wait_for_timeout(1500)
        if not camp:
            bc = [c for c in cons if "[basecamp]" in c or "base.glb" in c]
            ok("baseCampRoot presente", False, f"consola: {bc[:2]}")
        else:
            ok("baseCampRoot presente", True, json.dumps(camp))
        if camp and camp.get("proj"):
            px, py = camp["proj"]["x"], camp["proj"]["y"]
            inside = 0 <= px <= camp["vw"] and 0 <= py <= camp["vh"]
            ok("el campamento proyecta DENTRO del encuadre", inside,
               f"({px:.0f},{py:.0f}) de {camp['vw']}x{camp['vh']}")
        page.screenshot(path=f"{OUT}/t93-general.png", timeout=90000)
        if camp:
            page.evaluate(f"__SHERPAS_DEBUG.camPin({camp['x']}, 1.6, {camp['z']}, 9)")
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{OUT}/t93-campamento.png", timeout=90000)
            page.evaluate("__SHERPAS_DEBUG.camPin(null)")

        # ---------- T95: mallas bajo el Ricachón ----------
        print("== T95 vuelco de mallas bajo el ricachón ==", flush=True)
        dump = page.evaluate("""(() => {
            const sc = __SHERPAS_DEBUG.sceneObj();
            const pelvis = __SHERPAS_DEBUG.rich();
            if (!pelvis) return null;
            const px = pelvis.x, pz = pelvis.z;
            const out = [];
            for (const m of sc.scene.meshes) {
                if (!m.isEnabled() || !m.isVisible) continue;
                const bi = m.getBoundingInfo ? m.getBoundingInfo() : null;
                if (!bi) continue;
                const bb = bi.boundingBox;
                const c = bb.centerWorld, mn = bb.minimumWorld, mx = bb.maximumWorld;
                if (Math.abs(c.x - px) > 2.2 || Math.abs(c.z - pz) > 2.6) continue;
                if (mx.y < -0.05 || mn.y > pelvis.y + 1.2) continue;
                out.push({
                    name: m.name,
                    cx: +c.x.toFixed(2), cy: +c.y.toFixed(2), cz: +c.z.toFixed(2),
                    sx: +(mx.x - mn.x).toFixed(2), sy: +(mx.y - mn.y).toFixed(2), sz: +(mx.z - mn.z).toFixed(2),
                    minY: +mn.y.toFixed(2), maxY: +mx.y.toFixed(2),
                });
            }
            out.sort((a, b) => a.cy - b.cy);
            return { pelvis, meshes: out, total: sc.scene.meshes.length };
        })()""")
        ok("vuelco de mallas obtenido", dump is not None and dump.get("meshes") is not None)
        if dump:
            with open(f"{OUT}/t95-dump.json", "w") as f:
                json.dump(dump, f, ensure_ascii=False, indent=1)
            # T95 — los tirantes del rico quedan OCULTOS (la correa suelta)
            tir = page.evaluate("""(() => {
                const sc = __SHERPAS_DEBUG.sceneObj();
                const vis = [];
                for (const m of sc.scene.meshes) {
                    if ((m.name === "tirante_izq" || m.name === "tirante_der") &&
                        m.parent && m.parent.name === "__root__" && m.isVisible) vis.push(m.name);
                }
                return vis;
            })()""")
            ok("tirantes del ricachón OCULTOS (sin correa suelta)", len(tir) == 0, f"visibles={tir}")
            skip = ("ropeSeg", "screeFloor", "plantas_", "spur", "massif", "relief",
                    "pedriz", "rock", "holdBox", "presa", "faldon", "ground")
            interesting = [m for m in dump["meshes"] if not any(s in m["name"] for s in skip)]
            print(f"total mallas escena={dump['total']}, en columna={len(dump['meshes'])}, "
                  f"no-terreno={len(interesting)}", flush=True)
            print(json.dumps(interesting, ensure_ascii=False, indent=1)[:3000], flush=True)
        pv = dump["pelvis"] if dump else {"x": 0.8, "y": 1.2, "z": -1.2}
        page.evaluate(f"__SHERPAS_DEBUG.camPin({pv['x']}, {max(0.4, pv['y'] - 0.55)}, {pv['z']}, 3.2)")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{OUT}/t95-bajo-ricachon.png", timeout=90000)
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")

        # ---------- T97: voz ↔ texto (ANTES de los pins de caras) ----------
        print("== T97 voz ↔ texto ==", flush=True)
        # las caras deben estar cargadas para que sayRichLine acepte el globo
        t3 = time.time()
        while time.time() - t3 < 45:
            lf = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if (lf or {}).get("loaded") == 5:
                break
            page.wait_for_timeout(900)
        ok("caras cargadas antes de la voz", (lf or {}).get("loaded") == 5,
           f"loaded={(lf or {}).get('loaded')}")
        page.evaluate("__SHERPAS_DEBUG.force('condor')")  # CóndorLanded → condor_angry
        st0 = st = None
        t4 = time.time()
        while time.time() - t4 < 40:
            st = page.evaluate("__SHERPAS_DEBUG.richMood()")
            if (st or {}).get("mood") == "furia" or (st or {}).get("speech") is True:
                st0 = st
                break
            page.wait_for_timeout(700)
        ok("condor_angry → ánimo furia (cara gritando)",
           (st or {}).get("mood") == "furia", json.dumps(st))
        t5 = time.time()
        while time.time() - t5 < 12:
            st = page.evaluate("__SHERPAS_DEBUG.richMood()")
            if (st or {}).get("speech") is True:
                break
            page.wait_for_timeout(600)
        ok("condor_angry → bocadillo de habla con la transcripción",
           (st or {}).get("speech") is True, json.dumps(st))
        page.screenshot(path=f"{OUT}/t97-bocadillo.png", timeout=90000)

        # ---------- T96: las 5 caras ----------
        print("== T96 las 5 caras ==", flush=True)
        for mood, face in [("sorpresa", "asustado"), ("furia", "gritando"),
                           ("desconfianza", "chuleria"), ("enfado", "enfadado"),
                           ("soberbia", "orgulloso")]:
            page.evaluate(f"__SHERPAS_DEBUG.richMood('{mood}')")
            page.wait_for_timeout(900)
            f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            ok(f"cara {face} activa y visible con ánimo {mood}",
               (f or {}).get("active") == face and (f or {}).get("faceVisible") is True,
               json.dumps({k: (f or {}).get(k) for k in ("active", "headHidden", "faceVisible")}))
        loaded = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        ok("las 5 caras cargan", (loaded or {}).get("loaded") == 5, f"loaded={(loaded or {}).get('loaded')}")

        ok("0 errores JS", not errs, f"({len(errs)}) {errs[:2]}")

        # ---------- T94: minimapa en móvil (TÁCTIL) vs escritorio ----------
        print("== T94 minimapa móvil ==", flush=True)
        for name, vp, touch in [("movil_horizontal", {"width": 844, "height": 390}, True),
                                ("movil_vertical", {"width": 390, "height": 844}, True),
                                ("ventana_estrecha", {"width": 640, "height": 500}, False),
                                ("escritorio", {"width": 1280, "height": 720}, False)]:
            c2 = browser.new_context(viewport=vp, has_touch=touch, is_mobile=touch)
            p2 = c2.new_page()
            p2.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
            disp = None
            t2 = time.time()
            while time.time() - t2 < 40:
                try:
                    disp = p2.evaluate("""(() => {
                        const el = document.querySelector('.sphud .minimap');
                        return el ? getComputedStyle(el).display : null;
                    })()""")
                    if disp is not None:
                        break
                except Exception:
                    pass
                p2.wait_for_timeout(800)
            if name.startswith("movil") or name == "ventana_estrecha":
                ok(f"{name}: minimapa OCULTO", disp == "none", f"display={disp}")
            else:
                ok(f"{name}: minimapa visible", disp not in (None, "none"), f"display={disp}")
            c2.close()

        browser.close()
finally:
    server.terminate()
    httpd.shutdown()
print("SONDA T93-T97 VERDE" if not fails else f"SONDA T93-T97 FALLÓ: {fails}")
sys.exit(0 if not fails else 1)
