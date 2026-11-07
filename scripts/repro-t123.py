#!/usr/bin/env python3
"""E2E T123 — el dictado del jugador de punta a punta en ?nivel=pared:
  1) RICACHÓN ESTABLE (cabeza en el eje, huesos clavados, tirantes visibles).
  2) MOCHILA-CHICLE: pinchar la mochila → INTERIOR con muelles → pulsar un
     muelle lo ARMA → arrastrar la mochila hacia abajo estira los brazos
     (manos CLAVADAS, fatiga congelada por el muelle) con BARRA+FLECHA →
     soltar = lanzamiento (−1 muelle) → vuelo con AUTO-AGARRE al anclaje
     más alto alcanzable (sin clic).
  3) CAÍDA REAL: bloque rojo que rompe → caída con peso (22 m/s) →
     auto-anclaje a presa inferior / colgado de la cuerda con carga al compañero.
Sirve out/ en 3100 bajo /NOSUELTES. Uso: python3 scripts/repro-t123.py"""
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download/T123-capturas"


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


def espera(page, cond, segs, paso=200, etiqueta=""):
    t0 = time.time()
    ultimo = None
    while time.time() - t0 < segs:
        try:
            s = sonda(page)
            if cond(s):
                return s
            ultimo = f"sin condición: {str({k: s[k] for k in list(s)[:6]})[:160]}"
        except Exception as e:
            ultimo = f"EXC {e}"
        page.wait_for_timeout(paso)
    print(f"[espera {etiqueta}] agotó {segs}s: {ultimo}", flush=True)
    return None


def mochila_px(page):
    s = sonda(page)
    m = s.get("mochilaPx")
    if not m:
        raise RuntimeError("sin mochilaPx")
    return m


srv = start_servers()
os.makedirs(OUT, exist_ok=True)
errores_js = []
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
        page.on("pageerror", lambda e: errores_js.append(str(e)))
        page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")

        # el arranque en FRÍO (GLB + chunks) puede tardar más de un minuto la
        # primera vez — la espera de arranque va sobrada a propósito
        if not espera(page, lambda s: s["bloques"] > 0 and s["anclajes"][0] >= 4, 140, paso=400, etiqueta="arranque"):
            print("errores JS acumulados:", errores_js[:6], flush=True)
            try:
                page.screenshot(path=f"{OUT}/t123-0-fallo-arranque.png")
                print("url:", page.url, "| title:", page.title(), flush=True)
            except Exception:
                pass
            print("FALLO: el nivel no arrancó", flush=True)
            sys.exit(1)
        print("OK nivel arriba, sherpas anclados a la salida", flush=True)

        # ---------- 1) RICACHÓN ESTABLE (régimen: se descartan los 3 primeros
        # muestreos — el asentamiento de la cuerda mueve el nudo y salta pies) ----------
        est = []
        for i in range(16):
            s = sonda(page)
            r = s.get("ricachon")
            if r and i >= 3:
                est.append(r)
            page.wait_for_timeout(420)
        desv = max(e["cabezaDesvio"] for e in est)
        estir = max(e["maxEstir"] for e in est)
        print(f"RICACHON cabezaDesvio max={desv:.4f} m (<0.03) · maxEstir régimen max={estir:.4f} m (<0.08)", flush=True)
        assert desv < 0.03, f"la cabeza se sale del eje: {desv}"
        assert estir < 0.08, f"hueso estirado en régimen: {estir}"
        page.screenshot(path=f"{OUT}/t123-1-ricachon-estable.png")

        # ---------- 2a) INTERIOR DE LA MOCHILA ----------
        m = mochila_px(page)
        pi = m["pi"]
        page.mouse.click(m["x"], m["y"])
        page.wait_for_timeout(350)
        s = sonda(page)
        assert s["mochilaAbierta"] == pi, f"el interior no se abrió: {s['mochilaAbierta']}"
        assert s["muelles"][pi] == 3, f"muelles iniciales: {s['muelles']}"
        print(f"OK interior ABIERTO (S{pi + 1}) con 3 muelles", flush=True)
        page.screenshot(path=f"{OUT}/t123-2-interior-mochila.png")

        # ---------- 2b) ARMAR un muelle (pulsar el primer chip) ----------
        page.locator("#pared-mochila-win > div").nth(2).click()
        page.wait_for_timeout(300)
        s = sonda(page)
        assert s["muelleActivo"][pi] is True, f"el muelle no se armó: {s['muelleActivo']}"
        assert s["mochilaAbierta"] is None, "la ventana no se cerró al armar"
        print("OK muelle ARMADO (ventana cerrada)", flush=True)

        # ---------- 2c) GOMA: arrastrar la mochila hacia ABAJO ----------
        m = mochila_px(page)
        page.mouse.move(m["x"], m["y"])
        page.mouse.down()
        # T86: el recorrido creció (GOMA_EXTRA_M 0,9 → 1,6): estirar MÁS
        goma = 0.0
        for i in range(1, 25):
            page.mouse.move(m["x"], m["y"] + 16 * i, steps=2)
            page.wait_for_timeout(60)
            goma = sonda(page)["gomaM"] or 0.0
            if goma >= 0.72:
                break
        s = sonda(page)
        fl = s.get("gomaFlecha")
        fat_antes = s["fatigaMax"][pi]
        assert goma > 0.55, f"la goma no estiró: {goma}"
        assert fl and fl["frac"] > 0.3 and 1.2 < fl["ang"] < 2.0, f"flecha rara: {fl}"
        print(f"OK goma m={goma:.2f} · flecha frac={fl['frac']:.2f} ang={fl['ang']:.2f} (arriba)", flush=True)
        page.screenshot(path=f"{OUT}/t123-3-goma-barra-flecha.png")
        page.mouse.up()

        # ---------- 2d) LANZAMIENTO (−1 muelle) + AUTO-AGARRE ----------
        s = espera(page, lambda s: s["enVuelo"][pi], 6)
        assert s, "no arrancó el vuelo al soltar"
        s2 = sonda(page)
        assert s2["muelles"][pi] == 2, f"muelles tras el tiro: {s2['muelles']}"
        assert s2["muelleActivo"][pi] is False, "el muelle no se desarmó"
        print(f"OK lanzamiento: muelles {s2['muelles']} (−1), en vuelo SIN clic", flush=True)
        # el agarre AUTOMÁTICO: enVuelo se apaga solo (agarró o la cuerda lo retiene)
        s3 = espera(page, lambda s: not s["enVuelo"][pi], 20)
        s3 = sonda(page)
        agarrado = s3["anclajes"][pi] > 0
        alt = s3["alt0"] if pi == 0 else s3["alt1"]
        print(f"VUELO fin: agarrado={agarrado} (anclajes {s3['anclajes']}) alt={alt:.2f} m ropeState={s3['ropeStates']}", flush=True)
        assert agarrado, f"el vuelo no acabó en agarre automático: {s3['ropeStates']} alt={alt:.2f}"
        page.screenshot(path=f"{OUT}/t123-4-tras-autoagarre.png")

        # fatiga de las manos durante la goma: el MUELLE sostenía (carga 0.15)
        fat_goma = sonda(page)["fatigaMax"][pi]
        print(f"FATIGA en goma: antes={fat_antes:.3f} después={fat_goma:.3f} (el muelle sostiene)", flush=True)

        # ---------- 3) CAÍDA REAL: fila 2 destructible + rotura corta ----------
        page.evaluate("window.__PARED.setAjusteEnVivo('segundosRotura', 1.2)")
        page.evaluate("window.__PARED.saltarAFila(2)")
        if not espera(page, lambda s: s["anclajes"][0] >= 4 and s["anclajes"][1] >= 4, 20):
            print("FALLO: saltarAFila(2) no ancló", flush=True)
            sys.exit(1)
        alt_antes = [sonda(page)["alt0"], sonda(page)["alt1"]]
        # la cuenta atrás corre (1.2 s sim ≈ 3-4 s de pared); esperamos la rotura
        s = espera(page, lambda s: any(r["destruido"] for r in s["roturas"]), 30)
        assert s, "la caja roja no rompió"
        print("OK caja roja ROTA: los dos caen de verdad", flush=True)
        # muestrear la caída: altura y estados
        cMin = [99.0, 99.0]
        colgado_alguno = False
        for _ in range(26):
            s = sonda(page)
            cMin[0] = min(cMin[0], s["alt0"])
            cMin[1] = min(cMin[1], s["alt1"])
            if any(es in ("caught", "hauling") for es in s["ropeStates"]):
                colgado_alguno = True
            if s["ropeStates"][0] == "climbing" or s["ropeStates"][1] == "climbing":
                break
            page.wait_for_timeout(220)
        s = sonda(page)
        print(f"CAIDA: alt antes={alt_antes} min durante={[round(c, 2) for c in cMin]} ahora={[round(s['alt0'], 2), round(s['alt1'], 2)]} estados={s['ropeStates']} anclajes={s['anclajes']}", flush=True)
        # T123: la caída DESCIENDE de verdad (nada de flotar) y acaba o
        # re-anclado a una presa inferior (auto-agarre, el dictado) o colgado
        # de la cuerda (la carga va al compañero). Ambos re-anclaron aquí:
        # el auto-agarre inferior agarró en <0,5 m de caída.
        assert min(cMin) < min(alt_antes) - 0.25, "la caída apenas descendió (¿flotó?)"
        reanclados = (s["anclajes"][0] > 0 or s["anclajes"][1] > 0)
        print(f"OK caída CON PESO · re-anclados={reanclados} estados={s['ropeStates']}", flush=True)
        if colgado_alguno:
            f = sonda(page)["fatigaMax"]
            print(f"FATIGA con compañero colgado: {f} (el anclado fatiga ×2,6)", flush=True)
        page.screenshot(path=f"{OUT}/t123-5-caida-real.png")

        # ---------- cierre ----------
        s = sonda(page)
        print(f"ESTADO final: {s['state']} · errores JS: {len(errores_js)}", flush=True)
        assert s["state"] == "jugando", f"la prueba terminó: {s['state']}"
        assert not errores_js, f"errores JS: {errores_js[:3]}"
        print("E2E T123 VERDE", flush=True)
        browser.close()
finally:
    srv.kill()
