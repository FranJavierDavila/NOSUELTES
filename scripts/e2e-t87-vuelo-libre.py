#!/usr/bin/env python3
"""E2E T87 — VUELO LIBRE de la mochila-chicle (bug del jugador: «no lanza
hacia la dirección estipulada y se bloquea enganchado en los anclajes
próximos»). En ?nivel=pared:
  1) armar un muelle y arrastrar la mochila en DIAGONAL (abajo-derecha) —
     la flecha debe apuntar arriba-izquierda (ang en (π/2, π));
  2) soltar → VUELO LIBRE: durante el ascenso CERO anclajes (nada engancha
     en el arranque — el bug viejo agarraba en el tick 1-2);
  3) la cintura DERIVA hacia la IZQUIERDA mientras sube (la trayectoria
     sigue la flecha) y el vuelo gana ALTURA real;
  4) el vuelo acaba solo (agarre automático o captura de la cuerda), sin
     errores JS.
Sirve out/ en 3100 bajo /NOSUELTES. Uso: python3 scripts/e2e-t87-vuelo-libre.py"""
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download/T87-capturas"


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
            ultimo = str({k: s[k] for k in ("state", "enVuelo", "anclajes", "alt0", "alt1")})[:150]
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

        if not espera(page, lambda s: s["bloques"] > 0 and s["anclajes"][0] >= 4, 140, paso=400, etiqueta="arranque"):
            print("errores JS:", errores_js[:6], "url:", page.url, flush=True)
            print("FALLO: el nivel no arrancó", flush=True)
            sys.exit(1)
        print("OK nivel arriba", flush=True)

        # ---------- 1) interior + armar muelle ----------
        # warm-up: la mochila GLB llega asíncrona y el hit-test tarda en
        # activarse; el repro T123 muestreaba ~7 s antes del clic
        page.wait_for_timeout(4000)
        m = mochila_px(page)
        pi = m["pi"]
        abierto = None
        for intento in range(4):
            page.mouse.click(m["x"], m["y"])
            page.wait_for_timeout(500)
            abierto = sonda(page)["mochilaAbierta"]
            if abierto == pi:
                break
        s = sonda(page)
        assert abierto == pi, f"el interior no abrió tras reintentos: {abierto}"
        page.locator("#pared-mochila-win > div").nth(2).click()
        page.wait_for_timeout(300)
        assert sonda(page)["muelleActivo"][pi] is True, "el muelle no se armó"
        print("OK muelle ARMADO", flush=True)

        # ---------- 2) arrastre DIAGONAL abajo-derecha → flecha arriba-izquierda ----------
        m = mochila_px(page)
        x0px, y0px = m["x"], m["y"]
        page.mouse.move(x0px, y0px)
        page.mouse.down()
        goma = 0.0
        for i in range(1, 60):
            page.mouse.move(x0px + 9 * i, y0px + 13 * i, steps=2)
            page.wait_for_timeout(55)
            goma = sonda(page)["gomaM"] or 0.0
            if goma >= 1.3:
                break
        s = sonda(page)
        fl = s.get("gomaFlecha")
        assert goma > 1.2, f"la goma no estiró: {goma}"
        assert fl and fl["frac"] > 0.7, f"flecha sin fuerza: {fl}"
        # DIAGONAL: el puntero fue abajo-derecha ⇒ ang en (π/2, π) — apunta arriba-izquierda
        assert 1.65 < fl["ang"] < 2.6, f"la flecha NO es diagonal: {fl}"
        print(f"OK goma m={goma:.2f} · flecha DIAGONAL ang={fl['ang']:.2f} frac={fl['frac']:.2f}", flush=True)
        page.screenshot(path=f"{OUT}/t87-1-goma-diagonal.png")

        # ---------- 3) lanzamiento y muestreo del vuelo ----------
        x_ini = (sonda(page)["x0"] if pi == 0 else sonda(page)["x1"])
        t_lanz = time.time()
        page.mouse.up()
        s = espera(page, lambda s: s["enVuelo"][pi], 6)
        assert s, "no arrancó el vuelo al soltar"
        print("OK en vuelo", flush=True)

        muestras = []  # (t, enVuelo, anclajes, x, alt)
        while time.time() - t_lanz < 12:
            s = sonda(page)
            muestras.append((time.time() - t_lanz, s["enVuelo"][pi], s["anclajes"][pi],
                             s["x0"] if pi == 0 else s["x1"],
                             s["alt0"] if pi == 0 else s["alt1"]))
            if not s["enVuelo"][pi] and len(muestras) > 8:
                break
            page.wait_for_timeout(110)

        # (a) VUELO LIBRE: en el primer segundo REAL no hay NI UN anclaje
        temprano = [mm for mm in muestras if mm[0] <= 1.0]
        enganchados = [mm for mm in temprano if mm[2] > 0]
        assert temprano, "sin muestras tempranas del vuelo"
        assert not enganchados, f"SE ENGANCHÓ en el arranque: {enganchados[:3]}"
        print(f"OK vuelo LIBRE el primer segundo ({len(temprano)} muestras, 0 anclajes)", flush=True)
        # (a2) y NINGÚN anclaje mientras el vuelo sigue en marcha
        en_vuelo_con_anclajes = [mm for mm in muestras if mm[1] and mm[2] > 0]
        assert not en_vuelo_con_anclajes, f"anclajes durante el vuelo: {en_vuelo_con_anclajes[:3]}"

        # (b) DIRECCIÓN: mientras sube, la cintura deriva hacia la IZQUIERDA
        vuelo = [mm for mm in muestras if mm[1]]
        if len(vuelo) >= 3:
            alt_max = max(mm[4] for mm in vuelo)
            alt_ini = vuelo[0][4]
            subiendo = [mm for mm in vuelo if mm[4] < alt_max - 0.05]
            dx = subiendo[-1][3] - vuelo[0][3]
            print(f"TRAYECTORIA: alt {alt_ini:.2f}→{alt_max:.2f} m · dx en ascenso={dx:+.3f} m", flush=True)
            assert alt_max > alt_ini + 0.8, f"el vuelo no ganó altura: {alt_ini:.2f}→{alt_max:.2f}"
            assert dx < -0.5, f"NO sigue la flecha (esperaba deriva a la izquierda): dx={dx:+.3f}"
        else:
            print(f"AVISO: vuelo corto ({len(vuelo)} muestras en vuelo)", flush=True)

        # (c) el vuelo ACABA solo
        fin = espera(page, lambda s: not s["enVuelo"][pi], 15)
        assert fin, "el vuelo no acabó"
        s_end = sonda(page)
        print(f"FIN del vuelo: anclajes={s_end['anclajes']} ropeStates={s_end['ropeStates']}", flush=True)
        page.screenshot(path=f"{OUT}/t87-2-fin-vuelo.png")

        s = sonda(page)
        print(f"ESTADO final: {s['state']} · errores JS: {len(errores_js)}", flush=True)
        assert not errores_js, f"errores JS: {errores_js[:3]}"
        print("E2E T87 VERDE", flush=True)
        browser.close()
finally:
    srv.kill()
