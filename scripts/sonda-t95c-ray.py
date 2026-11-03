#!/usr/bin/env python3
"""T95c — rayos que incluyen TODAS las mallas (isPickable no importa) sobre la
franja amarilla bajo el ricachón, para nombrar la malla intrusa."""
import functools, http.server, json, os, socketserver, subprocess, threading, time, urllib.request
import sys

BASE = "http://localhost:3117"

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
            urllib.request.urlopen(BASE, timeout=1); return proc
        except Exception: time.sleep(0.5)
    proc.kill(); raise RuntimeError("servidor no arrancó")

class TS(socketserver.TCPServer):
    allow_reuse_address = True

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project")
httpd = TS(("127.0.0.1", 3193), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
_kill_stale(); server = start_server()
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox","--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage","--force-device-scale-factor=1",
                                           "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width":1000,"height":500})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        t0=time.time()
        while time.time()-t0 < 240:
            try:
                st = page.evaluate("""(() => ({
                    go: (() => { const b=document.querySelector('button[data-a=go]'); return !!(b&&(b.offsetWidth||b.offsetHeight)); })(),
                    seated: (() => { try { const r=__SHERPAS_DEBUG.richFall(); return !!(r&&r.seated); } catch { return false; } })(),
                }))()""")
                if st.get("seated"): break
                if st.get("go"): page.evaluate("document.querySelector('button[data-a=go]').click()")
                page.wait_for_timeout(1400)
            except Exception: page.wait_for_timeout(2000)
        page.wait_for_timeout(1500)
        pv = page.evaluate("__SHERPAS_DEBUG.rich()")
        page.evaluate(f"__SHERPAS_DEBUG.camPin({pv['x']}, {max(0.4, pv['y']-0.55)}, {pv['z']}, 3.2)")
        page.wait_for_timeout(1200)
        res = ''
        r = page.evaluate("""() => {
            const sc = __SHERPAS_DEBUG.sceneObj();
            let n = 0;
            for (const m of sc.scene.meshes) {
                if (m.name === "mochila" && m.parent && m.parent.name === "__root__" && Math.abs(m.getBoundingInfo().boundingBox.centerWorld.x - 0.85) < 0.05) { m.isVisible = false; n++; }
            }
            return n;
        }""")
        page.wait_for_timeout(500)
        page.screenshot(path="/tmp/render/t95-solo-mochila.png", timeout=90000)
        print("mochila rico ocultas:", r, flush=True)
        page.evaluate("""() => { for (const m of __SHERPAS_DEBUG.sceneObj().scene.meshes) if (m.name === "mochila") m.isVisible = true; }""")
        page.wait_for_timeout(300)
        r2 = page.evaluate("""() => {
            const sc = __SHERPAS_DEBUG.sceneObj();
            let n = 0;
            for (const m of sc.scene.meshes) {
                if ((m.name === "tirante_izq" || m.name === "tirante_der") && m.parent && m.parent.name === "__root__") { m.isVisible = false; n++; }
            }
            return n;
        }""")
        page.wait_for_timeout(500)
        page.screenshot(path="/tmp/render/t95-solo-tirantes.png", timeout=90000)
        print("tirantes rico ocultas:", r2, flush=True)
        page.evaluate("""() => { for (const m of __SHERPAS_DEBUG.sceneObj().scene.meshes) if (m.name.startsWith("tirante")) m.isVisible = true; }""")
        browser.close()
finally:
    server.terminate(); httpd.shutdown()
