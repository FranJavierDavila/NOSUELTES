#!/usr/bin/env python3
"""T98-caps: diagnóstico puntual — ¿por qué no hay gorros de nieve?"""
import functools, http.server, socketserver, subprocess, threading, time, urllib.request, os, sys

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
        ctx = browser.new_context(viewport={"width": 900, "height": 450})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        cons = []
        page.on("console", lambda m: cons.append(m.text[:200]))
        page.on("pageerror", lambda e: cons.append("PAGEERR " + str(e)[:200]))
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
        print("ready:", ready)
        page.wait_for_timeout(2000)
        out = page.evaluate("""(consJs) => {
            const sc = __SHERPAS_DEBUG.sceneObj(); const s = sc.scene;
            const names = s.meshes.map(m => m.name).filter(n => /snow|cap|boulder|drift/i.test(n));
            const master = s.getMeshByName('snowCapM');
            return {
                names: names.slice(0, 30),
                masterExists: !!master,
                masterVisible: master ? master.isVisible : null,
                masterInstances: master ? master.instances.length : null,
                rocks: sc.baseCampStats.rocks,
                consErr: consJs.filter(c => c.includes('PAGEERR') || /error/i.test(c)).slice(0, 4),
            };
        }""", cons)
        import json; print(json.dumps(out, indent=1, ensure_ascii=False))
        browser.close()
finally:
    server.kill(); httpd.shutdown()
