"""DISCRIMINADOR en-página: el host de la APP crea sala; en la MISMA página se
inyecta el bundle bun de trystero y se une a la misma sala. Si la copia ve un
peer (el host app), el announce de la app funciona; si no, está mudo."""
import functools
import http.server
import subprocess
import threading
import time
import os

from playwright.sync_api import sync_playwright

RELAYS = ("wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,"
          "wss://relay.nostr.bg,wss://nostr.mom,wss://relay.nostrcheck.me,"
          "wss://relay.agentry.com,wss://relay.nostr.blockhenge.com")

h = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project/scripts")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8124), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()

env = dict(os.environ, NODE_ENV="production", PORT="3100", HOSTNAME="127.0.0.1")
app = subprocess.Popen(["bun", ".next/standalone/server.js"], cwd="/home/z/my-project",
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import urllib.request
for _ in range(40):
    try:
        urllib.request.urlopen("http://127.0.0.1:3100", timeout=1)
        break
    except Exception:
        time.sleep(0.5)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--enable-unsafe-swiftshader",
                                    "--disable-dev-shm-usage"])
        pg = b.new_page(viewport={"width": 560, "height": 400})
        pg.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        cons = []
        pg.on("console", lambda m: cons.append(f"{m.type}: {m.text[:200]}") if "WebGL" not in m.text else None)
        pg.on("response", lambda r: cons.append(f"RESP {r.status} {r.url[:120]}") if r.status >= 400 else None)
        pg.on("pageerror", lambda e: cons.append("PAGEERROR: " + str(e)[:200]))
        pg.goto("http://127.0.0.1:3100", wait_until="domcontentloaded")
        # esperar el menú de verdad (el juego tarda en montar)
        t0 = time.time()
        while time.time() - t0 < 90:
            try:
                if pg.evaluate("!!document.querySelector('button[data-a=net]')"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(500)
        print("menú montado en", round(time.time() - t0, 1), "s")
        # latencia del event loop: deriva de 20 setTimeout(0) encadenados
        lag = pg.evaluate("""async () => {
          const d = [];
          for (let i = 0; i < 20; i++) {
            const t0 = performance.now();
            await new Promise(r => setTimeout(r, 0));
            d.push(performance.now() - t0);
          }
          d.sort((a, b) => a - b);
          return { p50: Math.round(d[10]), p95: Math.round(d[19]) };
        }""")
        print("lag event loop página app:", lag)
        print("isSecureContext:", pg.evaluate("window.isSecureContext"),
              "| crypto.subtle:", pg.evaluate("!!(window.crypto && window.crypto.subtle)"))
        # abrir la sala desde el UI de la app
        pg.evaluate("(() => { const e = document.querySelector('button[data-a=net]'); if (e) e.click(); })()")
        t0 = time.time()
        while time.time() - t0 < 15:
            try:
                if pg.evaluate("!!document.querySelector('[data-a=netHost]')"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(300)
        pg.evaluate("(() => { const e = document.querySelector('[data-a=netHost]'); if (e) e.click(); })()")
        pg.wait_for_timeout(2500)
        code = pg.evaluate("(function(){var b=document.querySelector('[data-a=netCodeBox]'); return b && !b.classList.contains('hidden') ? b.textContent : null;})()")
        print("sala app:", code)
        print("relays APP temprano:", pg.evaluate("window.__SHERPAS_DEBUG && JSON.stringify(__SHERPAS_DEBUG.net().relays)"))
        # TEST A: dos copias del BUNDLE en la página app, misma sala
        pg.evaluate(f"""async () => {{
          await new Promise((res, rej) => {{
            const s = document.createElement('script');
            s.src = 'http://127.0.0.1:8124/sonda-trystero-bundle.js';
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          }});
          const {{ joinRoom }} = window.TRYSTERO;
          const room = joinRoom({{ appId: 'nosueltes-sherpas-v1', relayUrls: '{RELAYS}'.split(',') }}, '{code}B');
          window.__CTRL = 'esperando';
          room.onPeerJoin((id) => {{ window.__CTRL = 'PEER-JOIN ' + id; }});
          const room2 = joinRoom({{ appId: 'nosueltes-sherpas-v1', relayUrls: '{RELAYS}'.split(',') }}, '{code}B');
          window.__CTRL2 = 'esperando';
          room2.onPeerJoin((id) => {{ window.__CTRL2 = 'PEER-JOIN ' + id; }});
        }}""")
        t0 = time.time()
        while time.time() - t0 < 25:
            c1 = pg.evaluate("window.__CTRL || null")
            c2 = pg.evaluate("window.__CTRL2 || null")
            if (c1 and c1 != 'esperando') or (c2 and c2 != 'esperando'):
                break
            pg.wait_for_timeout(1000)
        print(f"TEST A (dos copias bundle, misma página, sala {code}B): copia1={pg.evaluate('window.__CTRL')} copia2={pg.evaluate('window.__CTRL2')}")

        # inyectar la copia bundle y unirse a la misma sala en la misma página
        pg.evaluate(f"""async () => {{
          await new Promise((res, rej) => {{
            const s = document.createElement('script');
            s.src = 'http://127.0.0.1:8124/sonda-trystero-bundle.js';
            s.onload = res; s.onerror = rej; document.head.appendChild(s);
          }});
          const {{ joinRoom }} = window.TRYSTERO;
          const room = joinRoom({{ appId: 'nosueltes-sherpas-v1', relayUrls: '{RELAYS}'.split(',') }}, '{code}');
          window.__CTRL = 'esperando';
          const [, get] = room.makeAction('probe');
          room.onPeerJoin((id) => {{ window.__CTRL = 'PEER-JOIN ' + id; }});
          get((d) => {{ window.__CTRL = 'MSG ' + d; }});
        }}""")
        t0 = time.time()
        ctrl = None
        while time.time() - t0 < 20:
            ctrl = pg.evaluate("window.__CTRL || null")
            if ctrl and ctrl != "esperando":
                break
            pg.wait_for_timeout(1000)
        print("copia bundle en la página de la app:", ctrl)
        pg.wait_for_timeout(3000)
        # y al revés: la app ve a la copia? (onGuestJoined del host)
        st = pg.evaluate("(function(){var s=document.querySelector('[data-a=netStatus]'); return s ? s.textContent : '';})()")
        print("estado net de la app:", st)
        relays_app = pg.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.net().relays") or {}
        print("relays APP (readyState):")
        for u, rs in sorted(relays_app.items(), key=lambda kv: kv[1]):
            print(f"   {rs}  {u}")
        relays_copia = pg.evaluate("""(() => {
          const rs = window.TRYSTERO.getRelaySockets();
          return Object.fromEntries(Object.entries(rs).map(([u, w]) => [u, w.readyState]));
        })()""") or {}
        print("relays COPIA inyectada:")
        for u, rs in sorted(relays_copia.items(), key=lambda kv: kv[1]):
            print(f"   {rs}  {u}")
        print("consola (sin WebGL):")
        for l in cons[-12:]:
            print("  ", l)
        b.close()
finally:
    app.kill()
    srv.shutdown()
