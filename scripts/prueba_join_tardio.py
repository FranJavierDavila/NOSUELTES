"""Sonda de JOIN TARDÍO: A crea sala, B entra 20 s después (ambas con el
bundle bun). Si falla, el problema es la dinámica announce/subscribe de los
relays con joins tardíos; si pasa, el problema es específico del host app."""
import functools
import http.server
import threading
import time

from playwright.sync_api import sync_playwright

HANDLER = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project/scripts")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8125), HANDLER)
threading.Thread(target=srv.serve_forever, daemon=True).start()

RELAYS = "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://relay.nostr.bg,wss://nostr.mom,wss://relay.nostrcheck.me,wss://relay.agentry.com,wss://relay.nostr.blockhenge.com"
URL_A = f"http://127.0.0.1:8125/sonda-trystero.html?role=a&room=TARDIA1&app=nosueltes-probe-v1&relays={RELAYS}"
URL_B = f"http://127.0.0.1:8125/sonda-trystero.html?role=b&room=TARDIA1&app=nosueltes-probe-v1&relays={RELAYS}"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    logs = []
    pa = b.new_page()
    pa.on("console", lambda m: logs.append(f"A {m.type}: {m.text[:160]}") if "WebGL" not in m.text else None)
    pa.goto(URL_A, wait_until="domcontentloaded")
    print("A cargada; esperando 20 s antes de abrir B...")
    pa.wait_for_timeout(20000)
    pb = b.new_page()
    pb.on("console", lambda m: logs.append(f"B {m.type}: {m.text[:160]}") if "WebGL" not in m.text else None)
    pb.goto(URL_B, wait_until="domcontentloaded")
    res = [None, None]
    t0 = time.time()
    while time.time() - t0 < 45:
        res = [pa.evaluate("window.__RESULT || null"), pb.evaluate("window.__RESULT || null")]
        if all(res):
            break
        time.sleep(1)
    print("RESULTADO:", res)
    print("log A:", pa.evaluate("(window.__LOG||[]).join(' | ')")[:220])
    print("log B:", pb.evaluate("(window.__LOG||[]).join(' | ')")[:220])
    for l in logs[-14:]:
        print("  consola:", l)
    b.close()
srv.shutdown()
