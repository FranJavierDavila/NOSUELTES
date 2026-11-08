#!/usr/bin/env python3
"""E2E T93 — OLEADA DE FEEDBACK (dictados del jugador):
  1. BOLSA ATADA: el lazo vive (5 mallas: anillo + 2 orejas + 2 chicotes)
     colgado del nodo de la bolsa, con material de cuerda.
  2. BILLETES FUEGOS ARTIFICIALES: la sacudida de la rabieta suelta billetes
     con disparo fuerte (vy >= ~4,4), TODOS con spin propio; el papel SUBE
     varios bloques y luego CAE LENTO (terminal ~1,25 m/s).
  3. ESTRELLA: el elemento existe y va CENTRADO (translate(-50%,-50%)).
  4. CAIDA HONESTA: soltar las 4 extremidades de S0 -> cae con gravedad SIN
     re-anclarse (fuera el auto-agarre "bajo"), la cuerda lo captura (~2,9 m),
     queda DESPLOMADO (pecho desplazado lateral ~0,3 m) y el compañero S1
     (anclado arriba, 4/4) AGUANTA el tirón: conserva sus anclajes y su
     fatiga sube por el golpe.
Sirve el build standalone en 3100 y guarda capturas en download/.
"""
import subprocess, time, json, sys, urllib.request

PORT = 3100
BASE = f"http://127.0.0.1:{PORT}"
fallos = []

srv = subprocess.Popen(
    ["node", "/home/z/my-project/.next/standalone/server.js"],
    env={"PORT": str(PORT), "HOSTNAME": "127.0.0.1", "PATH": "/usr/bin:/bin", "NODE_ENV": "production"},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
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

        # --- nivel arriba y sherpas asentados (4 anclajes) ---
        s = None
        t0 = time.time()
        while time.time() - t0 < 140:
            s = page.evaluate("window.__PARED && window.__PARED.sonda()")
            if s and s.get("bloques", 0) > 0 and s["anclajes"][0] >= 4 and s.get("bolsa"):
                break
            page.wait_for_timeout(400)
        assert s and s["bloques"] > 0, f"el nivel no arrancó: {s}"
        print(f"nivel arriba: bloques={s['bloques']} anclajes={s['anclajes']} estado={s['state']}", flush=True)

        # --- 1) LAZO del saco ---
        lazo = s.get("lazo")
        if lazo == 5:
            print("OK 1 LAZO del saco: 5 mallas (anillo + 2 orejas + 2 chicotes)", flush=True)
        else:
            fallos.append(f"lazo={lazo} (esperaba 5)")
        page.screenshot(path="/home/z/my-project/download/t93-saco-lazo.png")

        # --- 2) BILLETES: esperar la primera sacudida (rabieta 7-11 s) ---
        sac0 = s["sacudidas"]
        vyv = None
        t0 = time.time()
        while time.time() - t0 < 60:
            s = page.evaluate("window.__PARED.sonda()")
            if s["sacudidas"] > sac0 and s["billetes"] > 0:
                vyv = s["billetesVy"]
                break
            page.wait_for_timeout(250)
        if vyv and vyv[1] >= 4.2:
            print(f"OK 2a DISPARO de fuegos al nacer: vy=[{vyv[0]}, {vyv[1]}] m/s (>= 4,2)", flush=True)
        else:
            fallos.append(f"el disparo no es de fuegos: vy={vyv}")
        if s["billetesSpin"] == s["billetes"] and s["billetes"] > 0:
            print(f"OK 2b SPIN PROPIO en los {s['billetes']} billetes vivos", flush=True)
        else:
            fallos.append(f"spin: {s['billetesSpin']}/{s['billetes']}")

        # subida al ápice y caída lenta (muestreo ~14 s)
        altMax = -99
        tApex = None
        nacio = None
        cayoLento = False
        t0 = time.time()
        while time.time() - t0 < 16:
            s = page.evaluate("window.__PARED.sonda()")
            if s["billetes"] == 0 and time.time() - t0 > 6:
                break
            alt = s["billetesAlt"]
            if alt > -50:
                if nacio is None: nacio = alt
                if alt > altMax:
                    altMax = alt; tApex = time.time()
                elif tApex and altMax - alt > 1.2:
                    vy = s["billetesVy"]
                    if vy and -1.45 <= vy[0] <= -0.2:
                        cayoLento = True
            page.wait_for_timeout(300)
        if nacio is not None and altMax - nacio >= 3.5:
            print(f"OK 2c EL DISPARO SUBE: nace ~{nacio:.1f} m -> ápice {altMax:.1f} m (+{altMax-nacio:.1f})", flush=True)
        else:
            fallos.append(f"la subida no se ve: nacio={nacio} altMax={altMax}")
        if cayoLento:
            print("OK 2d CAÍDA LENTA de hoja (terminal dentro de [-1,45, -0,2] m/s)", flush=True)
        else:
            fallos.append("no se vio la caída lenta del papel")

        # --- 3) ESTRELLA: centrada en la mochila (CSS) ---
        css = page.evaluate("document.getElementById('pared-estrella-0')?.getAttribute('style') || ''")
        if "translate(-50%,-50%)" in css:
            print("OK 3 ESTRELLA centrada (translate(-50%,-50%))", flush=True)
        else:
            fallos.append(f"estrella CSS: {css[:80]}")

        # --- 4) CAÍDA HONESTA + TIRÓN ---
        s = page.evaluate("window.__PARED.sonda()")
        fat1_0 = s["fatigaMax"][1]
        ancl1_0 = s["anclajes"][1]
        page.evaluate("window.__PARED.sueltaSherpa(0)")
        cayoRapido = False
        reanclajo = False
        filas = []
        t0 = time.time()
        prevAlt = None
        while time.time() - t0 < 8:
            s = page.evaluate("window.__PARED.sonda()")
            alt = s["alt0"]
            vy = (alt - prevAlt) / 0.3 if prevAlt is not None else 0
            prevAlt = alt
            filas.append({"t": round(time.time()-t0, 1), "alt": round(alt, 2), "vy": round(vy, 1),
                          "rope": s["ropeStates"][0], "anc": s["anclajes"][0]})
            if s["anclajes"][0] > 0 and s["ropeStates"][0] == "falling":
                reanclajo = True
            if not cayoRapido and vy <= -2.5 and s["ropeStates"][0] == "falling":
                cayoRapido = True   # gravedad real (sin flotación)
            if s["ropeStates"][0] == "caught":
                break
            page.wait_for_timeout(300)
        print("caída S0:", json.dumps(filas[-6:]), flush=True)
        if cayoRapido:
            print("OK 4a CAÍDA con gravedad real (vy <= -2,5 m/s en descenso)", flush=True)
        else:
            fallos.append("la caída NO alcanzó velocidad de gravedad (¿algo la frena?)")
        if not reanclajo:
            print("OK 4b SIN auto-agarre en la caída (0 anclajes hasta la cuerda)", flush=True)
        else:
            fallos.append("se re-ancló durante la caída (quedó flotando)")
        if filas and filas[-1]["rope"] == "caught":
            print(f"OK 4c LA CUERDA lo capturó (cuelga a {filas[-1]['alt']:.1f} m)", flush=True)
        else:
            fallos.append(f"no llegó a colgarse: {filas[-1] if filas else None}")

        # desplome: el pecho se desploma hacia un lado (~0,3 m)
        desp = 0.0
        t0 = time.time()
        while time.time() - t0 < 3:
            s = page.evaluate("window.__PARED.sonda()")
            desp = max(desp, abs(s["desplome"][0]))
            page.wait_for_timeout(250)
        if desp > 0.15:
            print(f"OK 4d DESPLOMADO colgando: pecho desviado {desp:.2f} m (cuerpo horizontal)", flush=True)
        else:
            fallos.append(f"no se desploma: desviación {desp:.2f}")
        page.screenshot(path="/home/z/my-project/download/t93-colgado-desplomado.png")

        # el compañero (anclado ARRIBA, 4/4) aguanta el tirón
        s = page.evaluate("window.__PARED.sonda()")
        if s["anclajes"][1] == 4:
            subioFat = s["fatigaMax"][1] > fat1_0 + 0.05
            if subioFat:
                print(f"OK 4e S1 AGUANTÓ el tirón: 4/4 anclajes, fatiga {fat1_0:.2f} -> {s['fatigaMax'][1]:.2f}", flush=True)
            else:
                fallos.append(f"S1 no notó el tirón: fatiga {fat1_0} -> {s['fatigaMax'][1]}")
        else:
            print(f"  nota: S1 tenía {ancl1_0}->{s['anclajes'][1]} anclajes (el tirón lo arrancó o no estaba arriba)", flush=True)
            fallos.append(f"S1 perdió anclajes: {ancl1_0} -> {s['anclajes'][1]}")

        browser.close()
finally:
    srv.terminate()

print("", flush=True)
if fallos:
    print("E2E T93 ROJO:", len(fallos), "fallos")
    for f in fallos: print("  -", f)
    sys.exit(1)
print("E2E T93 VERDE: lazo, fuegos+spin+caída lenta, estrella centrada, caída honesta+desplome+tirón")
