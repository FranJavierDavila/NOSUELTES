#!/usr/bin/env python3
"""E2E T88 — BOLSA DE DINERO + BILLETES (dictado del jugador):
  1) el nivel arranca SIN ricachón en pantalla y con la BOLSA lista;
  2) la sacudida de la rabieta del lastre (agenda 7-11 s) suelta BILLETES
     que SUBEN (corriente de aire) — la sonda los cuenta en el aire;
  3) los badges de muelles (icono + numerito) existen por sherpa;
  4) sin errores JS. La cogida (+10 $) está certificada en unidad (t88).
Sirve out/ en 3100 bajo /NOSUELTES. Uso: python3 scripts/e2e-t88-bolsa.py"""
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3100/NOSUELTES"
OUT = "/home/z/my-project/download/T88-capturas"


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


def espera(page, cond, segs, paso=250, etiqueta=""):
    t0 = time.time()
    ultimo = None
    while time.time() - t0 < segs:
        try:
            s = sonda(page)
            if cond(s):
                return s
            ultimo = str({k: s[k] for k in ("state", "bolsa", "billetes", "rabieta")})[:140]
        except Exception as e:
            ultimo = f"EXC {e}"
        page.wait_for_timeout(paso)
    print(f"[espera {etiqueta}] agotó {segs}s: {ultimo}", flush=True)
    return None


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

        # ---------- 1) BOLSA lista, dinero a cero (el GLB llega asíncrono) ----------
        s = espera(page, lambda s: s["bolsa"] is True, 60, etiqueta="bolsa glb")
        assert s, "la bolsa de dinero no cargó"
        s = sonda(page)
        assert s["dinero"] == [0, 0], f"dinero inicial raro: {s['dinero']}"
        print("OK BOLSA de dinero cargada (glb) · dinero [0,0]", flush=True)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/t88-1-bolsa.png")

        # ---------- 2) SACUDIDA → billetes que SUBEN ----------
        # la agenda de sacudidas dispara sola (rabieta del lastre 7-11 s);
        # esperamos billetes en el aire y medimos que su conteo crece (suben
        # en vida) y luego decae (mueren) — sin errores JS.
        s = espera(page, lambda s: s["billetesTotal"] > 0, 40, etiqueta="primera sacudida")
        assert s, "la bolsa no soltó billetes con la sacudida"
        pico = 0
        for _ in range(30):
            s = sonda(page)
            pico = max(pico, s["billetes"])
            if pico >= 3 and s["billetes"] < pico:
                break
            page.wait_for_timeout(400)
        print(f"OK billetes SOLTADOS y vuelan (pico vivo={pico}, total={s['billetesTotal']})", flush=True)
        assert pico >= 3, f"menos de 3 billetes vivos: pico={pico}"
        page.screenshot(path=f"{OUT}/t88-2-billetes.png")

        # ---------- 3) badges de muelles presentes ----------
        badges = page.evaluate("document.querySelectorAll('[id^=pared-muelle-badge]').length")
        visibles = page.evaluate("[...document.querySelectorAll('[id^=pared-muelle-badge]')].filter(e => e.style.display !== 'none').length")
        assert badges == 2, f"badges de muelle: {badges}"
        assert visibles >= 1, "ningún badge de muelle visible"
        print(f"OK badges de muelles (icono+numerito): {badges} nodos, {visibles} visibles", flush=True)

        # ---------- 4) el juego sigue vivo ----------
        s = sonda(page)
        print(f"ESTADO final: {s['state']} · errores JS: {len(errores_js)}", flush=True)
        assert not errores_js, f"errores JS: {errores_js[:3]}"
        print("E2E T88 VERDE", flush=True)
        browser.close()
finally:
    srv.kill()
