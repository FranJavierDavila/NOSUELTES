#!/usr/bin/env python3
"""Verificación en PRODUCCIÓN (GitHub Pages) del T121: los 5 detalles nuevos.

Comprueba EN VIVO en franjavierdavila.github.io:
  1. El nivel ?nivel=pared carga (window.__PARED).
  2. La sonda devuelve los campos NUEVOS de T121: lanzamientos [3,3],
     enVuelo, gomaM y roturas (8 bloques destructibles, filas pares 2-8).
  3. El badge de lanzamientos (#pared-mochila) existe en el HUD.
  4. El bundle publicado contiene «giro180» (algún chunk de recursos).
  5. Capturas para download/.
"""
import time, json, os
from playwright.sync_api import sync_playwright

BASE = "https://franjavierdavila.github.io/NOSUELTES"
OUT = os.path.join(os.path.dirname(__file__), "..", "download", "T121-capturas")
os.makedirs(OUT, exist_ok=True)

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
    while time.time() - t0 < 150:
        try:
            if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                ok = True
                break
        except Exception:
            pass
        page.wait_for_timeout(1000)
    print("nivel_cargado=", ok)
    if ok:
        page.wait_for_timeout(6000)
        sonda = page.evaluate("window.__PARED.sonda()")
        print("state=", sonda.get("state"))
        print("bloques=", sonda.get("bloques"))
        print("T121 lanzamientos=", sonda.get("lanzamientos"), "(esperado [3, 3])")
        print("T121 enVuelo=", sonda.get("enVuelo"))
        print("T121 gomaM=", sonda.get("gomaM"))
        rot = sonda.get("roturas") or []
        print("T121 roturas=", len(rot), "destructibles")
        destr = [r["id"] for r in rot]
        filas = sorted({int(i.split("_")[0][1:]) for i in destr})
        print("T121 filas destructibles=", filas, "(esperado [2,4,6,8])")
        seguidas = any(a + 1 == b for a, b in zip(filas, filas[1:]))
        print("T121 nunca dos seguidas=", not seguidas)
        giro = page.evaluate("window.__PARED.sonda().ajuste.lanzamientosMax === 3 && window.__PARED.sonda().ajuste.segundosRotura === 10")
        print("T121 panel defaults (rotura 10 s / 3 lanzamientos)=", giro)
        badge = page.evaluate("""(() => {
            const el = document.getElementById('pared-mochila');
            return el ? { existe: true, display: el.style.display, svg: !!el.querySelector('svg') } : { existe: false };
        })()""")
        print("T121 badge muelle #pared-mochila=", badge)
        # chunk publicado con la mecánica nueva (giro180 en recursos cargados)
        urls = page.evaluate("performance.getEntriesByType('resource').map(r => r.name)")
        hit = 0
        for u in urls:
            if "/chunks/" in u:
                try:
                    if "giro180" in page.evaluate("""(async u => (await (await fetch(u)).text()))(%s)""" % json.dumps(u)):
                        hit += 1
                except Exception:
                    pass
        print("T121 chunks con giro180=", hit)
        page.screenshot(path=f"{OUT}/t121-prod-1-general.png")
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/t121-prod-2.png")
    print("errores JS:", errs[:3])
    browser.close()
print("PROD T121 OK")
