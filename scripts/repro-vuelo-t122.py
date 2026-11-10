#!/usr/bin/env python3
"""E2E T122 — la mochila-chicle de punta a punta en el nivel ?nivel=pared:
badge de muelle → goma SOSTENIDA (servo) → lanzamiento → AGARRE EN VUELO
(clic que ELIGE presa, imán de cuerpo, mano que sale sola) → supervivencia.
Además: insignias de fatiga (8), ricachón colgado del nudo y rabietas.
Sirve out/ en 3100 bajo /NOSUELTES. Uso: python3 scripts/repro-vuelo-t122.py"""
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download/T122-capturas"


def start_servers():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("el servidor estático no arrancó")


def sonda(page):
    return page.evaluate("window.__PARED.sonda()")


def espera(page, cond, segs, paso=200):
    t0 = time.time()
    while time.time() - t0 < segs:
        try:
            s = sonda(page)
            if cond(s):
                return s
        except Exception:
            pass
        page.wait_for_timeout(paso)
    return None


srv = start_servers()
os.makedirs(OUT, exist_ok=True)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
        ])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
        if not espera(page, lambda s: s is not None, 90):
            print("NO APARECIÓ __PARED", flush=True)
            sys.exit(1)
        page.wait_for_timeout(3500)

        W, H = 1280, 720
        # 1) insignias de fatiga (bindPlayers crea los 8 nodos .lbadge)
        s0 = sonda(page)
        print(f"insignias visibles: {s0['insignias']}", flush=True)
        page.screenshot(path=f"{OUT}/t122-1-insignias.png")

        # 2) clic SECO en la mochila → badge de muelle con lanzamientos.
        #    La pieza «mochila» de la marioneta GLB llega ASÍNCRONA: reintentar
        #    con proyección FRESCA (backpackScreenPx) hasta que el badge salga.
        badge = "none"
        for intento in range(8):
            m = sonda(page)["mochilaPx"]
            if m is None:
                page.wait_for_timeout(1500)
                continue
            if intento == 0:
                print(f"mochila S{m['pi'] + 1} en px: ({m['x']:.0f}, {m['y']:.0f})", flush=True)
            for dy in (-14, 0, 14):
                for dx in (-14, 0, 14):
                    page.mouse.click(m["x"] + dx, m["y"] + dy)
                    page.wait_for_timeout(120)
                    badge = page.evaluate("getComputedStyle(document.querySelector('#pared-mochila')).display")
                    if badge == "flex":
                        break
                if badge == "flex":
                    break
            if badge == "flex":
                break
            page.wait_for_timeout(1500)
        print(f"badge tras clics: {badge}", flush=True)

        # 3) tirar de la mochila hacia ABAJO: la goma SOSTIENE el estiramiento
        #    (adaptativo: seguir bajando hasta m ≥ 0,45 — la escala px→m depende
        #    de la cámara)
        s1 = sonda(page)
        m1 = s1["mochilaPx"]
        page.mouse.move(m1["x"], m1["y"])
        page.mouse.down()
        goma = 0.0
        for i in range(1, 26):
            page.mouse.move(m1["x"], m1["y"] + 20 * i)
            page.wait_for_timeout(40)
            if i % 4 == 0:
                goma = sonda(page)["gomaM"] or 0.0
                if goma >= 0.45:
                    break
        page.wait_for_timeout(600)
        s2 = sonda(page)
        goma = s2["gomaM"] or 0.0
        print(f"goma sostenida tras 0,6 s = {goma:.2f}", flush=True)
        page.screenshot(path=f"{OUT}/t122-2-goma.png")
        page.mouse.up()
        page.wait_for_timeout(300)
        s3 = sonda(page)
        print(f"soltar: enVuelo={s3['enVuelo']} lanzamientos={s3['lanzamientos']}", flush=True)

        # 4) AGARRE EN VUELO: clics que ELIGEN presa — ráfaga de candidatos
        #    (salida_* primero: estáticos y junto al punto de lanzamiento)
        #    hasta que la sonda vea vueloObjetivo fijado; proyección FRESCA en
        #    cada intento (el swap async de la marioneta desplaza las piezas).
        objetivo = None
        eligio = False
        pi = s1["mochilaPx"]["pi"]
        t0w = time.time()
        while time.time() - t0w < 15:
            s4 = sonda(page)
            if not s4["enVuelo"][pi]:
                break
            if not s4["vueloObjetivo"]:
                mpx = s4["mochilaPx"]
                msx, msy = mpx["x"] / W * 100, mpx["y"] / H * 100
                cerca = {
                    k: v for k, v in s4["presas"].items()
                    if abs(v["sx"] - msx) <= 16 and 2 < v["sy"] < msy - 1 and (msy - v["sy"]) <= 15
                }
                orden = sorted(
                    cerca.items(),
                    key=lambda kv: (0 if kv[0].startswith("salida") else 1)
                    + (msy - kv[1]["sy"]) / 100 + abs(kv[1]["sx"] - msx) / 200,
                )
                for k, v in orden[:3]:
                    page.mouse.click(v["sx"] / 100 * W, v["sy"] / 100 * H)
                    objetivo = v
                    page.wait_for_timeout(60)
                    if sonda(page)["vueloObjetivo"]:
                        eligio = True
                        objetivo = v
                        break
            if eligio:
                break
            page.wait_for_timeout(120)
        s5 = espera(page, lambda s: not s["enVuelo"][pi], 12)
        page.wait_for_timeout(600)
        s5 = sonda(page)
        pi = s1["mochilaPx"]["pi"]
        print(f"tras vuelo: state={s5['state']} alt{pi}={s5[f'alt{pi}']:.2f} "
              f"objetivo={s5['vueloObjetivo']} mano={s5['vueloMano']} (objetivo clicado: {objetivo})", flush=True)
        page.screenshot(path=f"{OUT}/t122-3-tras-agarre.png")
        # vista del ricachón colgado de la V
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/t122-4-ricachon.png")

        # 5) ricachón + rabietas — la SIMULACIÓN corre más lenta que el reloj
        #    (escena pesada): muestrear por TIEMPO SIM (~30 s = al menos una
        #    pausa completa de rabieta) con tope de pared por si acaso
        ric = s5["ricachon"]
        pico = 0.0
        t0sim = s5["t"]
        t0w = time.time()
        while time.time() - t0w < 130:
            s = sonda(page)
            pico = max(pico, s["rabieta"])
            if s["t"] >= t0sim + 30:
                break
            page.wait_for_timeout(250)
        print(f"ricachon: nudoY={ric['nudoY']:.2f} comba={ric['comba']:.2f} (cabezaY={ric['cabezaY']:.2f})", flush=True)
        print(f"rabieta pico={pico:.2f}", flush=True)
        print(f"errores JS: {errs[:3]}", flush=True)
        print("RESUMEN: " + json.dumps({
            "insignias": s0["insignias"], "badge": badge, "goma_sostenida": round(goma, 2),
            "enVuelo": s3["enVuelo"], "lanz1": s3["lanzamientos"], "objetivo": objetivo,
            "vueloObjetivo": s5["vueloObjetivo"], "mano": s5["vueloMano"],
            "state": s5["state"], "supervive": s5["state"] == "jugando",
            "alt": round(s5[f"alt{pi}"], 2), "ricachon": ric, "rabieta_pico": round(pico, 2),
            "js_errores": len(errs),
        }, ensure_ascii=False), flush=True)
        browser.close()
finally:
    srv.kill()
print("E2E T122 LISTO")
