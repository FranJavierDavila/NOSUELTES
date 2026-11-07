#!/usr/bin/env python3
"""DIAG T89 — CAÍDA tras el lanzamiento vertical (el caso del jugador):
lanza VERTICAL con goma larga y muestrea el descenso: enVuelo, anclajes,
vy, presa libre más cercana a cada mano y estados. Sirve out/ en 3100."""
import subprocess, time, urllib.request, sys

BASE = "http://127.0.0.1:3100/NOSUELTES"

srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/", timeout=1); break
    except Exception: time.sleep(0.5)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                           "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        t0 = time.time()
        while time.time() - t0 < 140:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4:
                break
            page.wait_for_timeout(400)
        print("nivel arriba", s["state"], flush=True)

        pi = 0
        page.evaluate(f"""(() => {{
          const P = window.__PARED;
          P.abreMochilaDev && P.abreMochilaDev({pi});
        }})()""")
        # abrir interior + armar (índice 3: tit, pista, dinero, chips).
        # warm-up: la mochila GLB llega asíncrona (como en t87/repro)
        page.wait_for_timeout(4000)
        m = None
        for _ in range(30):
            m = page.evaluate("window.__PARED.sonda().mochilaPx")
            if m: break
            page.wait_for_timeout(400)
        assert m, "mochilaPx nunca proyectó"
        pi = m["pi"]  # el sherpa cuya mochila se ve en pantalla
        page.mouse.click(m["x"], m["y"]); page.wait_for_timeout(500)
        page.locator("#pared-mochila-win > div").nth(3).click(); page.wait_for_timeout(300)
        st = page.evaluate("window.__PARED.sonda()")
        print("muelleActivo:", st["muelleActivo"], flush=True)

        # arrastre VERTICAL hacia abajo (máxima goma)
        m = page.evaluate("window.__PARED.sonda().mochilaPx")
        page.mouse.move(m["x"], m["y"])
        page.mouse.down()
        for i in range(1, 60):
            page.mouse.move(m["x"], m["y"] + 14 * i)
            page.wait_for_timeout(30)
            gm = page.evaluate("window.__PARED.sonda().gomaM")
            if gm is not None and gm >= 2.6: break
        print("gomaM antes de soltar:", page.evaluate("window.__PARED.sonda().gomaM"), flush=True)
        huesos = page.evaluate("window.__PARED.sonda().gomaHuesos")
        print("GOMA HUESOS (uarm≈0.46, farm estirado):", huesos, flush=True)
        assert huesos and huesos["farm"] > 0.6 and 0.40 <= huesos["uarm"] <= 0.55, \
            f"el antebrazo NO se estira visualmente: {huesos}"
        print("OK CHICLE del antebrazo MEDIDO en pantalla", flush=True)
        page.mouse.up()

        # muestrear el vuelo
        filas = []
        prev_alt = None
        t_lanz = time.time()
        for _ in range(90):
            s = page.evaluate("window.__PARED.sonda()")
            alt = s["alt0"]
            vy = (alt - prev_alt) / 0.28 if prev_alt is not None else 0.0
            prev_alt = alt
            fila = {"t": round(time.time() - t_lanz, 1), "en": s["enVuelo"][0],
                    "anc": s["anclajes"][0], "alt": round(alt, 2), "vy~": round(vy, 1),
                    "rope": s["ropeStates"][0]}
            filas.append(fila)
            if len(filas) > 4 and s["anclajes"][0] > 0:
                print("AGARRADO en t≈%.1f s" % (time.time() - t_lanz), flush=True)
                break
            if s["state"] == "fallado" or fila["rope"] == "grounded":
                print("SUELO/FALLO sin agarrar", flush=True)
                break
            page.wait_for_timeout(280)
        for f in filas:
            print(f, flush=True)
        browser.close()
finally:
    srv.kill()
