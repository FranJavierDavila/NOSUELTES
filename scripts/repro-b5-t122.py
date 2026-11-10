#!/usr/bin/env python3
"""Verificación T122 — nivel Prueba del Campamento en LOCAL (?nivel=pared).

1. Insignias de fatiga por extremidad (8 nodos .lbadge visibles).
2. B5 mochila-chicle de punta a punta: badge ×3 → goma sostenida → lanzamiento
   (lanzamientos −1) → clic en presa en vuelo → state=jugando (NO fallado).
3. Ricachón de lastre: cuelga bajo el nudo medio de la cuerda y hay rabieta
   (rabieta>0) en los primeros ~14 s.
4. Capturas para download/.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3199/NOSUELTES"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/z/my-project/download/T122-capturas"
os.makedirs(OUT, exist_ok=True)


def start_server():
    srv = subprocess.Popen(
        ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3199"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            return srv
        except Exception:
            time.sleep(0.5)
    srv.kill()
    raise RuntimeError("servidor estático no arrancó")


def sonda(page):
    try:
        return page.evaluate("window.__PARED && window.__PARED.sonda && window.__PARED.sonda()")
    except Exception:
        return None


def click(page, x, y, hold_ms=25):
    page.mouse.move(x, y)
    page.mouse.down()
    page.wait_for_timeout(hold_ms)
    page.mouse.up()
    page.wait_for_timeout(30)


srv = start_server()
res = {}
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
        t0 = time.time()
        ok = False
        while time.time() - t0 < 90:
            if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                ok = True
                break
            page.wait_for_timeout(500)
        print("nivel_cargado=", ok)
        if not ok:
            sys.exit(1)
        page.wait_for_timeout(5000)

        # --- 1. insignias de fatiga ---
        n_badges = page.evaluate("document.querySelectorAll('.sphud .lbadge').length")
        visibles = page.evaluate("""[...document.querySelectorAll('.sphud .lbadge')]
            .filter(b => b.style.display !== 'none').length""")
        print("1. insignias_fatiga nodos=%s visibles=%s" % (n_badges, visibles))
        res["badges"] = n_badges
        page.screenshot(path=f"{OUT}/t122-1-insignias.png")

        # --- 2. B5 completo ---
        BX, BY = 546, 330
        click(page, BX, BY, hold_ms=40)
        badge = page.evaluate("document.getElementById('pared-mochila')?.style.display")
        s = sonda(page)
        print("2a. badge_mochila=%s lanzamientos=%s" % (badge, s.get("lanzamientos")))
        res["badge"] = badge
        page.screenshot(path=f"{OUT}/t122-2-badge-muelle.png")

        # goma: arrastrar abajo y VERIFICAR que se sostiene (servo)
        page.mouse.move(BX, BY)
        page.mouse.down()
        estiramiento = []
        for dy in (40, 80, 120, 160, 200):
            page.mouse.move(BX, BY + dy)
            page.wait_for_timeout(50)
            s = sonda(page)
            estiramiento.append(s.get("gomaM"))
        page.wait_for_timeout(400)  # el muelle del rig intentaría recuperar: el servo aguanta
        s = sonda(page)
        goma_sostenida = s.get("gomaM")
        print("2b. goma durante arrastre=%s y TRAS 0,4 s sostenida=%s" % (
            [round(v, 2) if v else None for v in estiramiento],
            round(goma_sostenida, 2) if goma_sostenida is not None else None))
        res["goma_sostenida"] = goma_sostenida
        page.screenshot(path=f"{OUT}/t122-3-goma-estirada.png")
        page.mouse.up()
        s = sonda(page)
        en_vuelo = s.get("enVuelo")
        lanz1 = s.get("lanzamientos")
        print("2c. soltar: enVuelo=%s lanzamientos=%s" % (en_vuelo, lanz1))
        res["enVuelo"], res["lanz1"] = en_vuelo, lanz1
        page.screenshot(path=f"{OUT}/t122-4-vuelo.png")

        # agarre asistido: clics rápidos en vuelo hasta que termine EN JUGANDO
        agarrado = False
        for dy in range(-20, -291, -30):
            for dx in (-60, 0, 60):
                click(page, BX + dx, BY + dy)
                s = sonda(page)
                ev = s.get("enVuelo") or [False, False]
                if not any(ev):
                    break
            if not any(ev):
                break
        page.wait_for_timeout(1500)
        s = sonda(page)
        agarrado = s.get("state") == "jugando"
        print("2d. tras el vuelo: state=%s alt0=%.2f (agarró/capturó=%s)" % (s.get("state"), s.get("alt0"), agarrado))
        res["supervive"] = agarrado
        page.screenshot(path=f"{OUT}/t122-5-tras-agarre.png")

        # --- 3. ricachón de lastre + rabieta ---
        s = sonda(page)
        ric = s.get("ricachon")
        print("3a. ricachon=%s" % json.dumps(ric))
        res["ricachon"] = ric
        # esperar la primera rabieta (proximaT 6-10 s; ya pasaron ~8-10 s de HUD)
        t0 = time.time()
        pico = 0.0
        while time.time() - t0 < 25:
            s = sonda(page)
            pico = max(pico, s.get("rabieta") or 0)
            if pico > 0.5:
                break
            page.wait_for_timeout(200)
        print("3b. rabieta pico=%.2f (berrinche visto=%s)" % (pico, pico > 0.5))
        res["rabieta_pico"] = round(pico, 2)
        bubble = page.evaluate("""(() => {
            const b = [...document.querySelectorAll('.sphud div')].find(d => (d.textContent||'').includes('BAJE') || (d.textContent||'').includes('abogado'));
            return !!b;
        })()""")
        print("3c. bocadillo/frase visible en HUD=%s" % bubble)
        page.screenshot(path=f"{OUT}/t122-6-ricachon.png")
        print("errores JS:", errs[:3])
        browser.close()
finally:
    srv.kill()

print("RESUMEN:", json.dumps(res, ensure_ascii=False))
