#!/usr/bin/env python3
"""T95b — identificar el OBJETO amarillo bajo el ricachón: picking de pantalla
sobre la franja (cámara igual que t95-bajo-ricachon) + AABB de lo pickeado."""
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
    raise RuntimeError("servidor no arrancó")


class TS(socketserver.TCPServer):
    allow_reuse_address = True


Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project")
httpd = TS(("127.0.0.1", 3199), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

_kill_stale()
server = start_server()
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
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        t0 = time.time()
        while time.time() - t0 < 240:
            try:
                st = page.evaluate("""(() => ({
                    go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                    seated: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })(),
                }))()""")
                if st.get("seated"):
                    break
                if st.get("go"):
                    page.evaluate("document.querySelector('button[data-a=go]').click()")
                page.wait_for_timeout(1400)
            except Exception:
                page.wait_for_timeout(2000)
        print("sentado", flush=True)
        page.wait_for_timeout(1500)
        pv = page.evaluate("__SHERPAS_DEBUG.rich()")
        page.evaluate(f"__SHERPAS_DEBUG.camPin({pv['x']}, {max(0.4, pv['y'] - 0.55)}, {pv['z']}, 3.2)")
        page.wait_for_timeout(1200)
        # malla bajo el puntero en una rejilla de la mitad baja del encuadre
        picks = page.evaluate("""(() => {
            const sc = __SHERPAS_DEBUG.sceneObj();
            const out = [];
            for (let sy = 150; sy <= 460; sy += 35) {
                for (let sx = 300; sx <= 760; sx += 45) {
                    const pick = sc.scene.pick(sx, sy, (m) => m.isPickable !== false && m.isVisible && m.isEnabled());
                    if (pick && pick.hit && pick.pickedMesh) {
                        const m = pick.pickedMesh;
                        const bb = m.getBoundingInfo().boundingBox;
                        const mn = bb.minimumWorld, mx = bb.maximumWorld;
                        out.push({
                            sx, sy, name: m.name,
                            c: [ +bb.centerWorld.x.toFixed(2), +bb.centerWorld.y.toFixed(2), +bb.centerWorld.z.toFixed(2) ],
                            s: [ +(mx.x-mn.x).toFixed(2), +(mx.y-mn.y).toFixed(2), +(mx.z-mn.z).toFixed(2) ],
                        });
                    }
                }
            }
            return out;
        })()""")
        seen: dict[str, dict] = {}
        for p in picks:
            k = p["name"]
            if k not in seen:
                seen[k] = p
        for name, p in sorted(seen.items(), key=lambda kv: -sum(1 for q in picks if q["name"] == kv[0])):
            n = sum(1 for q in picks if q["name"] == name)
            print(f"{n:3d} px  {name:26s} c={p['c']} s={p['s']}", flush=True)
        browser.close()
finally:
    server.terminate()
    httpd.shutdown()
