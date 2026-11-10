#!/usr/bin/env python3
"""Verificación E2E del T92 en producción LOCAL (:3001).

Comprueba EN VIVO el circuito de recompensas:
  1. El nivel ?nivel=pared carga (window.__PARED).
  2. CIRCUITO TRIPLE: 67 bloques, yCima ≈ 61.1, formas variadas.
  3. VERDES y AZULES presentes (≥4 cada uno) con sus estados.
  4. PLATAFORMAS PREMIO: 2, con 20 presas c/u y saco colgado por el cuello.
  5. FUEGOS ARTIFICIALES: sacudida de la bolsa → pico de billetes varios
     bloques por encima del amarre, y bajada posterior.
  6. MOCHILA: panel con UN icono de muelle + número (regresión T91).
  7. 0 errores JS + capturas para download/.
"""
import time, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("T92_BASE", "http://127.0.0.1:3001")
OUT = os.path.join(os.path.dirname(__file__), "..", "download", "T92-capturas")
os.makedirs(OUT, exist_ok=True)

FALLOS = []

def chk(nombre, cond, detalle=""):
    print(("OK   " if cond else "FALLO") + f" {nombre}" + (f" — {detalle}" if detalle else ""))
    if not cond:
        FALLOS.append(nombre)

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script("try{localStorage.setItem('ns.onboarding.seen.v1','1')}catch(e){}")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(BASE + "/?nivel=pared", wait_until="domcontentloaded")
    t0 = time.time()
    ok = False
    while time.time() - t0 < 120:
        try:
            if page.evaluate("!!(window.__PARED && window.__PARED.sonda)"):
                ok = True
                break
        except Exception:
            pass
        page.wait_for_timeout(1000)
    print("nivel_cargado=", ok)
    if not ok:
        print("ERRORES_JS=", errs)
        sys.exit(1)
    page.wait_for_timeout(7000)  # GLB y materiales

    s = page.evaluate("window.__PARED.sonda()")
    print("state=", s.get("state"))
    chk("CIRCUITO TRIPLE: 67 bloques", s.get("bloques") == 67, f"bloques={s.get('bloques')}")
    chk("cima efectiva ≈ 61.1 (triple)", abs((s.get("yCimaEfectiva") or 0) - 61.1) < 0.01, f"yCima={s.get('yCimaEfectiva')}")

    formas = s.get("formas") or {}
    chk("FORMAS variadas (≥3 tipos)", len(formas) >= 3, f"formas={formas}")

    verdes = s.get("verdes", 0)
    azules = s.get("azules", 0)
    chk("VERDES presentes (≥4)", verdes >= 4, f"verdes={verdes}")
    chk("AZULES presentes (≥4)", azules >= 4, f"azules={azules}")

    premios = s.get("premios") or []
    chk("2 PLATAFORMAS PREMIO", len(premios) == 2, f"premios={[p.get('id') for p in premios]}")
    for p in premios:
        chk(f"plataforma {p.get('id')}: 20 presas (todas las caras)", p.get("presas") == 20, f"presas={p.get('presas')}")
        chk(f"plataforma {p.get('id')}: saco colgado listo", p.get("lista") is True, f"lista={p.get('lista')} y={p.get('y')}")
    # el saco cuelga POR DEBAJO de la plataforma (fila 9 → y≈19.3 − 0.75 − cuerda)
    if premios and premios[0].get("y") is not None:
        chk("saco premio cuelga BAJO la plataforma", premios[0]["y"] < 19.3 - 0.6, f"y={premios[0]['y']}")

    # MOCHILA: abrir el interior y contar iconos de muelle (UNO con número)
    page.evaluate("window.__PARED.abrirMochilaProbe ? window.__PARED.abrirMochilaProbe() : null")
    iconos = page.evaluate("""(() => {
        const win = document.getElementById('pared-mochila-win');
        if (!win) return -1;
        return win.querySelectorAll('[data-e="muelleIcono"]').length;
    })()""")
    chk("MOCHILA: UN solo icono de muelle (T91 intacto)", iconos == 1, f"iconos={iconos}")

    # FUEGOS ARTIFICIALES: sacudir la bolsa y medir el pico de billetes
    amarre_y = page.evaluate("window.__PARED.sonda().bolsaGeo ? window.__PARED.sonda().yCimaEfectiva : null")
    page.evaluate("window.__PARED.sacudirProbe ? window.__PARED.sacudirProbe() : window.__PARED.sacudidaBolsa && window.__PARED.sacudidaBolsa()")
    pico = -99; bajo = 99; vivo0 = 0
    for i in range(40):
        page.wait_for_timeout(500)
        st = page.evaluate("window.__PARED.sonda()")
        py = st.get("billetesPicoY")
        vivo0 = st.get("billetes", 0)
        if py is not None:
            pico = max(pico, py)
    print("billetes_vivos=", vivo0, "picoY=", round(pico, 2))
    chk("BILLETES FUEGOS ARTIFICIALES: pico varios bloques sobre el amarre", pico > 6.0, f"picoY={round(pico,2)} m")
    # y CAEN: el vivo nunca se desboca (mueren por reposo del suelo/vida)
    page.wait_for_timeout(4000)
    st = page.evaluate("window.__PARED.sonda()")
    chk("billetes acotados (los fuegos se apagan; las rabietas sueltan otros)", (st.get("billetes", 0)) <= 16,
        f"vivo_final={st.get('billetes', 0)}")

    # captura general del circuito
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, "t92-circuito-general.png"))
    page.evaluate("window.scrollTo(0,0)")

    # VERDE girando + AZUL derivando: forzar carga en verdes/azules y medir
    page.evaluate("window.__PARED.cargaEspecialProbe()")
    spin0 = page.evaluate("window.__PARED.sonda().verdeSpinMax")
    drift0 = page.evaluate("window.__PARED.sonda().azulDriftMax")
    page.wait_for_timeout(3000)
    spin1 = page.evaluate("window.__PARED.sonda().verdeSpinMax")
    drift1 = page.evaluate("window.__PARED.sonda().azulDriftMax")
    page.evaluate("window.__PARED.soltarEspecialProbe()")
    chk("VERDE ocupado GIRA (spin crece)", spin1 > spin0 + 1.0, f"spin {spin0} -> {round(spin1,2)} rad (~{round(spin1*57.3)} grados)")
    chk("AZUL ocupado SE ALEJA hacia los lados (deriva crece)", drift1 > drift0 + 0.2, f"drift {drift0} -> {round(drift1,2)} m")
    page.wait_for_timeout(2500)
    st = page.evaluate("window.__PARED.sonda()")
    chk("VERDE/AZUL libres: vuelven (giro y deriva decaen)", (st.get("verdeSpinMax") or 1) < spin1 and (st.get("azulDriftMax") or 1) < drift1,
        f"spin {round(spin1,2)}->{st.get('verdeSpinMax')} drift {round(drift1,2)}->{st.get('azulDriftMax')}")

    # captura general del circuito
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(OUT, "t92-circuito-general.png"))

    chk("0 ERRORES JS", len(errs) == 0, "; ".join(errs[:3]))
    browser.close()

print()
print("RESULTADO T92:", "VERDE" if not FALLOS else f"ROJO ({len(FALLOS)} fallos: {FALLOS})")
sys.exit(0 if not FALLOS else 1)
