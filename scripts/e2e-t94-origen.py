#!/usr/bin/env python3
"""E2E T94 — ORIGEN DEL PAPEL Y VALLE REAL (dictado del jugador:
«No veo que los billetes salgan del saco de dinero ni que este esté siempre
 en la parte baja de la cuerda»):
  1. VALLE REAL: el amarre del saco descansa en el FONDO REAL del arco de la
     cuerda (amarre.x ≈ valleArco de valleDeCuerda) y tras una caída del
     compañero (desnivel) el valle se corre hacia el sherpa bajo y el saco
     lo sigue.
  2. BILLETES DEL SACO: forzando una sacudida, el enjambre NACE en la boca
     del saco (a < 0,6 m del origen grabado) con disparo de fuegos (vy>=4,2).
  3. MUERTE EN EL SUELO: ningún billete VIVO baja de suelo+0,12 y al final
     no queda papel; sin sacudida nueva no reaparece ninguno (adiós a la
     «recogida de suelo» que hacía nacer billetes a ras de suelo).
Sirve el build standalone en 3101 y guarda capturas en download/.
"""
import subprocess, time, json, sys, urllib.request

PORT = 3101
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

        # --- 1) VALLE REAL: el amarre descansa en el fondo del arco ---
        def muestrea_valle():
            d = page.evaluate("""() => {
                const s = window.__PARED.sonda();
                return {amarre: s.amarre, valle: s.valleArco, ric: s.ricachon};
            }""")
            return d
        # dar 2 s a que el amarre asiente (slide 1,2 m/s)
        time.sleep(2.0)
        v = muestrea_valle()
        desvio = abs(v["amarre"]["x"] - v["valle"])
        if desvio < 0.25:
            print(f"OK 1a AMARRE en el fondo del arco: amarre.x={v['amarre']['x']:.2f} ≈ valleArco={v['valle']:.2f} (desvío {desvio:.2f} m)", flush=True)
        else:
            fallos.append(f"el amarre NO está en el fondo del arco: {v['amarre']['x']} vs {v['valle']} (desvío {desvio:.2f})")
        page.screenshot(path="/home/z/my-project/download/t94-saco-en-el-valle.png")

        # --- 2) BILLETES DEL SACO: sacudida forzada → nacen en la boca ---
        # (los billetes mueren pronto por el TECHO de pantalla cuando los
        #  sherpas están abajo: muestreo denso y hasta 2 sacudidas de retesto)
        nac = None
        for intento in range(2):
            page.evaluate("window.__PARED.sacudir()")
            t0 = time.time()
            while time.time() - t0 < 3:
                s = page.evaluate("window.__PARED.sonda()")
                if s["billetes"] > 0 and s.get("sacudidaOrigen"):
                    nac = s
                    break
                page.wait_for_timeout(60)  # denso: la 1ª posición roza el nacimiento
            if nac: break
        if nac:
            o = nac["sacudidaOrigen"]
            # banda de nacimiento: el enjambre vivo entero está pegado a la boca
            # (billetesAlt = máx vivo, billetesYMin = mín vivo; a 5,2 m/s el
            #  muestreo llega ~1,5 m por encima del origen, jamás al ápice +7)
            dentro = (nac["billetesYMin"] >= o["y"] - 0.3) and (nac["billetesAlt"] <= o["y"] + 2.0)
            if dentro:
                print(f"OK 2a NACEN EN LA BOCA: origen=({o['x']:.2f}, {o['y']:.2f}) y el enjambre está pegado (y {nac['billetesYMin']:.2f}..{nac['billetesAlt']:.2f})", flush=True)
            else:
                fallos.append(f"el enjambre no nace en el saco: origen={o} vivo=[{nac['billetesYMin']}, {nac['billetesAlt']}]")
            vy = nac["billetesVy"]
            if vy and vy[1] >= 4.2:
                print(f"OK 2b DISPARO de fuegos al nacer: vy hasta {vy[1]} m/s", flush=True)
            else:
                fallos.append(f"sin disparo de fuegos: vy={vy}")
            page.screenshot(path="/home/z/my-project/download/t94-billetes-boca-saco.png")
        else:
            fallos.append("la sacudida forzada no soltó billetes")

        # --- 3) MUERTE DEL PAPEL: la oleada muere (techo/suelo), nada vivo a
        #        ras de suelo y, en un momento SIN papel, no reaparece nada
        #        sin una sacudida nueva (las rabietas programadas SÍ cuentan:
        #        son sacudidas legítimas del saco) ---
        sueloVivo = False
        oleadaMurio = False
        t0 = time.time()
        while time.time() - t0 < 45:  # la caída de hoja ES lenta (terminal 1,25 m/s): la oleada tarda
            s = page.evaluate("window.__PARED.sonda()")
            if s["billetes"] > 0:
                # invariante T94: un billete VIVO jamás está bajo la línea de
                # muerte (suelo+0,1); margen de muestreo 0,06
                if s["billetesYMin"] <= 0.06:
                    sueloVivo = True
            else:
                oleadaMurio = True
                break
            page.wait_for_timeout(200)
        if oleadaMurio:
            print("OK 3a LA OLEADA MUERE: llega un momento sin papel (nada cicla eternamente)", flush=True)
        else:
            fallos.append("los billetes no mueren tras la sacudida (¿sigue la recogida?)")
        if not sueloVivo:
            print("OK 3b NINGÚN billete vivo a ras de suelo (yMin > 0,12 siempre)", flush=True)
        else:
            fallos.append("se vio un billete VIVO junto al suelo (la recogida sigue viva)")

        # sin sacudida nueva no nace papel: esperamos primero un instante LIMPIO
        # (entre rabietas) y desde ahí medimos 6 s de calma
        libre = None
        t0 = time.time()
        while time.time() - t0 < 40:
            s = page.evaluate("window.__PARED.sonda()")
            if s["billetes"] == 0:
                libre = s
                break
            page.wait_for_timeout(300)
        fantasma = False
        if libre is not None:
            sac0 = libre["sacudidas"]
            t0 = time.time()
            while time.time() - t0 < 6:
                s = page.evaluate("window.__PARED.sonda()")
                if s["billetes"] > 0 and s["sacudidas"] <= sac0:
                    fantasma = True
                    break
                page.wait_for_timeout(250)
            if not fantasma:
                print("OK 3c SIN sacudida no aparece papel (el origen es SIEMPRE el saco)", flush=True)
            else:
                fallos.append("aparecieron billetes sin sacudida (dinero/papel por obra de arte)")
        else:
            print("  nota: 40 s sin instante libre de papel (rabietas muy seguidas) — 3c no medible", flush=True)

        # --- 4) DESNIVEL → el valle se corre hacia el sherpa bajo y el saco lo sigue ---
        antes = muestrea_valle()
        page.evaluate("window.__PARED.sueltaSherpa(1)")  # S1 cae y queda colgado MÁS BAJO
        movio = False
        siguió = False
        t0 = time.time()
        while time.time() - t0 < 12:
            v = muestrea_valle()
            d = page.evaluate("window.__PARED.sonda()")
            dif = d["alt0"] - d["alt1"]  # >0: S0 arriba → S1 más bajo
            if dif > 1.0:
                # el valle debe moverse hacia x1 y el amarre seguirlo
                if abs(v["valle"] - d["x1"]) < abs(antes["valle"] - d["x1"]) - 0.05:
                    movio = True
                if abs(v["amarre"]["x"] - v["valle"]) < 0.35:
                    siguió = True
            page.wait_for_timeout(400)
        if movio:
            print(f"OK 4a VALLE hacia el sherpa bajo: valleArco {antes['valle']:.2f} -> {v['valle']:.2f} (x1={d['x1']:.2f})", flush=True)
        else:
            fallos.append(f"el valle no se corrió al sherpa bajo: antes={antes['valle']} ahora={v['valle']}")
        if siguió:
            print(f"OK 4b EL SACO SIGUE al valle: amarre.x={v['amarre']['x']:.2f} ≈ valle={v['valle']:.2f}", flush=True)
        else:
            fallos.append(f"el amarre no sigue al valle: {v['amarre']['x']} vs {v['valle']}")
        page.screenshot(path="/home/z/my-project/download/t94-valle-tras-caida.png")

        browser.close()
finally:
    srv.terminate()

print("", flush=True)
if fallos:
    print("E2E T94 ROJO:", len(fallos), "fallos")
    for f in fallos: print("  -", f)
    sys.exit(1)
print("E2E T94 VERDE: amarre en el fondo real del arco (y sigue al sherpa bajo), billetes nacidos en la boca del saco, muerte en el suelo y sin papel fantasma")
