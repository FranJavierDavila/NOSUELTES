#!/usr/bin/env python3
"""Sonda T120b: por qué no se ve la cuerda entre los dos escaladores."""
import subprocess, time, os, urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"


def start_servers():
    srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("sin servidor")


srv = start_servers()
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(3000)
        out = page.evaluate("""(() => {
            const P = window.__PARED;
            const rn = P.ropeNodes || [];
            const nodos = rn.map(n => [ +n.pos.x.toFixed(2), +n.pos.y.toFixed(2), +n.pos.z.toFixed(2) ]);
            const scene = window.__SHERPAS_DEBUG && window.__SHERPAS_DEBUG.sceneObj && window.__SHERPAS_DEBUG.sceneObj();
            let segs = null;
            if (scene && scene.meshes) {
                segs = scene.meshes.filter(m => /ropeSeg/.test(m.name)).slice(0, 40)
                    .map(m => ({ n: m.name, vis: m.isVisible, p: [+m.position.x.toFixed(2), +m.position.y.toFixed(2), +m.position.z.toFixed(2)], s: +m.scaling.y.toFixed(2) }));
            }
            const cinturas = (P.sherpas || []).map(s => { const w = s.waist(); return [+w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2)]; });
            const ropeMaster = scene && scene.meshes ? scene.meshes.filter(m => m.name === 'ropeMaster').map(m => ({ vis: m.isVisible, mat: m.material && m.material.name })) : null;
            return { nNodos: rn.length, nodos: nodos.slice(0, 20), cinturas, segsVisibles: segs ? segs.filter(s => s.vis).length : null, segs: segs ? segs.slice(0, 8) : null, ropeMaster };
        })()""")
        import json
        print(json.dumps(out, indent=1)[:3000])
        print("errores:", errs[:3])
        browser.close()
finally:
    srv.kill()
