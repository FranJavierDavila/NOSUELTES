"""Prueba juegos de relays Nostr con la sonda real (2 pestañas Chromium +
trystero): cada set tiene 35 s para emparejar y cruzar un mensaje."""
import functools
import http.server
import threading
import time

from playwright.sync_api import sync_playwright

HANDLER = functools.partial(http.server.SimpleHTTPRequestHandler, directory="/home/z/my-project/scripts")
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8124), HANDLER)
threading.Thread(target=srv.serve_forever, daemon=True).start()

SETS = {
    "A_damus_nos_primal": "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net",
    "B_mom_bg_oxtr": "wss://nostr.mom,wss://relay.nostr.bg,wss://nostr.oxtr.dev",
    "C_check_wlvs_oldcity": "wss://relay.nostrcheck.me,wss://nostr-relay.wlvs.space,wss://relay.oldcity-bitcoiners.info,wss://nostr.einundzwanzig.space",
    "D_agentry_blockhenge": "wss://relay.agentry.com,wss://relay.nostr.blockhenge.com,wss://relay.piazza.today",
}

with sync_playwright() as p:
    b = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    for name, relays in SETS.items():
        vals = {}
        pages = []
        for role in ("a", "b"):
            pg = b.new_page()
            pg.goto(f"http://127.0.0.1:8124/sonda-trystero.html?role={role}&room={name}&relays={relays}", wait_until="domcontentloaded")
            pages.append(pg)
        t0 = time.time()
        while time.time() - t0 < 35:
            vals = [pg.evaluate("window.__RESULT || null") for pg in pages]
            if all(vals):
                break
            time.sleep(1)
        status = "OK" if all(v == "OK" for v in vals) else ("PARCIAL" if any(v == "OK" for v in vals) else "FALLO")
        print(f"{status}  {name}  ({[v for v in vals]})")
        for pg in pages:
            pg.close()
    b.close()
srv.shutdown()
