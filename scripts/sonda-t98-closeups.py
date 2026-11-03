#!/usr/bin/env python3
"""T98-closeups: capturas de campamento y suelo con camPin conocidos buenos."""
import functools, http.server, socketserver, subprocess, threading, time, urllib.request, os

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
            urllib.request.urlopen(BASE, timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill(); raise RuntimeError("sin servidor")

class TS(socketserver.TCPServer): allow_reuse_address = True
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project")
httpd = TS(("127.0.0.1", 3199), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
_kill_stale(); server = start_server()

try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox","--autoplay-policy=no-user-gesture-required","--disable-dev-shm-usage","--force-device-scale-factor=1","--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 1000, "height": 500})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.goto(f"{BASE}/?test=escalada", wait_until="domcontentloaded", timeout=60000)
        t0 = time.time(); ready = False
        while time.time() - t0 < 240:
            st = page.evaluate("""(() => {
                if (!window.__SHERPAS_DEBUG) return {};
                const sc = __SHERPAS_DEBUG.sceneObj();
                if (!sc || !sc.scene) return { debug: true };
                const b = document.querySelector('button[data-a=go]');
                if (b && (b.offsetWidth || b.offsetHeight)) { b.click(); return { debug: true }; }
                return { debug: true, camp: !!sc.scene.getNodeByName('baseCampRoot') };
            })()""")
            if st.get("camp"): ready = True; break
            page.wait_for_timeout(1500)
        print("ready:", ready, flush=True)
        page.wait_for_timeout(2500)

        # campamento: parámetros que funcionaron en la sonda T93 (dist 9)
        page.evaluate("__SHERPAS_DEBUG.camPin(4.8, 1.6, -2.9, 9)")
        page.wait_for_timeout(2500)
        page.screenshot(path="/tmp/render/t98-campamento.png", timeout=120000)
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")
        page.wait_for_timeout(800)
        # suelo rasante al pie del muro, franja de caída con nieve/hielo
        page.evaluate("__SHERPAS_DEBUG.camPin(0.5, 0.5, -5.5, 6.5)")
        page.wait_for_timeout(2500)
        page.screenshot(path="/tmp/render/t98-suelo.png", timeout=120000)
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")
        browser.close()
        print("capturas listas", flush=True)
finally:
    server.kill(); httpd.shutdown()
