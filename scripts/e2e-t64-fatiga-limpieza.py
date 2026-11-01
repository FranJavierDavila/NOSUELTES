#!/usr/bin/env python3
"""E2E T64 — ADIÓS NO SUELTES (1 jugador) + FATIGA POR TIEMPO EN EL MISMO AGARRE.
(1) MENÚ DIRECTO: la página monta SHERPAS AL LÍMITE sin lanzador; no queda ni
    rastro de "ELIGE TU ASCENSO", la tarjeta "NO SUELTES" ni el prototipo viejo.
(2) FATIGA POR TIEMPO (T69, regla del jugador: 10 s sin variar → +1 %/s; el
    descuelgue AL 100% = círculo completo 360°; y COLGADO DE UNA SOLA MANO el
    reloj corre AL DOBLE): en partida real, las manos ancladas a la misma presa
    ven su indicador SUBIR con los segundos (sonda rope: f = fatiga, s =
    segundos en la misma presa).
(3) EL INDICADOR SE DISPARA: la fatiga cruza el umbral de aviso (naranja) con
    el estancamiento y las capturas muestran las barras subiendo.
(4) REGRESIÓN: sin errores JS y capturas con luminancia válida."""
import json as _json
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []
# el umbral naranja REAL lo dicta el pack (regla de oro): hud.fatigue.warnAt
WARN_AT = _json.load(open("/home/z/my-project/public/content/sherpas/hud.json"))["fatigue"]["warnAt"]


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def luma(path, x0=0.30, y0=0.30, x1=0.70, y1=0.75):
    from PIL import Image as _Img
    img = _Img.open(path).convert("L")
    w, h = img.size
    c = img.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
    return sum(c.getdata()) / (c.width * c.height)


def shot(page, path, tries=10, wait_ms=2500):
    from PIL import Image as _Img
    stat = 0
    for i in range(tries):
        page.screenshot(path=path)
        img = _Img.open(path).convert("L")
        w, h = img.size
        c = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
        stat = sum(c.getdata()) / (c.width * c.height)
        if 6 < stat < 245:
            return stat
        page.wait_for_timeout(wait_ms)
    return stat


def ev(page, expr, tries=12):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(500)
    return None


def rope(page):
    return ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope(0) : null; })()")


def start_match(page):
    page.goto(URL + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    # SIN lanzador: el overlay de arranque (¡GO!) está disponible directo
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.evaluate("document.querySelector('button[data-a=go]').click()")  # JS: el hit-target de Playwright se cuelga
    page.wait_for_timeout(1200)
    # saltar onboarding si aparece (primera vez en este perfil)
    for _ in range(8):
        try:
            avanzado = page.evaluate("""(() => {
              const b = document.querySelector('[data-a=obNext]');
              if (!b || !b.offsetParent) return false;
              b.click();
              return true;
            })()""")
        except Exception:
            avanzado = False
        if not avanzado:
            break
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            ok = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            ok = False
        if ok:
            break
        page.wait_for_timeout(2000)
    check("partida real arrancada", time.time() - t0 < 145)
    page.wait_for_timeout(9000)  # warm-up shaders + HDRI


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])

    # ---------- ESCENARIO A: el menú ES sherpas (sin NO SUELTES) ----------
    print("== A. MENÚ DIRECTO, SIN LA MODALIDAD NO SUELTES ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.wait_for_timeout(1500)

    titulo = ev(page, "document.title") or ""
    check("título de la página = SHERPAS AL LÍMITE", "SHERPAS" in str(titulo).upper(), f"({titulo})")
    cuerpo = ev(page, "document.body.innerText") or ""
    check("no queda 'ELIGE TU ASCENSO' (lanzador fuera)", "ELIGE TU ASCENSO" not in cuerpo)
    check("no queda tarjeta 'NO SUELTES' de 1 jugador", "NO SUELTES" not in cuerpo)
    check("no queda '1 jugador · clásico'", "1 jugador" not in cuerpo)
    check("el arranque cooperativo sigue (¡GO! visible)", page.is_visible("button[data-a=go]"))
    l0 = shot(page, f"{OUT}/t64-0-menu-directo.png")
    check("captura del menú con luminancia válida", 8 < l0 < 250, f"(luma={l0:.0f})")
    check("sin errores JS en el menú", len(errors) == 0, f"({errors[:2]})")
    page.close()

    # ---------- ESCENARIO B: fatiga por tiempo en partida real ----------
    print("== B. FATIGA POR TIEMPO: 10 s SIN VARIAR → EL INDICADOR SUBE +1 %/s ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_match(page)

    # espera a que una mano esté anclada y ESTANCADA (s >= 10,5 s de sim)
    r = None
    t0 = time.time()
    while time.time() - t0 < 240:
        r = rope(page)
        if r:
            manos = [l for l in r["limbs"][:2] if l and l["a"]]
            if manos and max(l["s"] for l in manos) >= 10.5:
                break
        page.wait_for_timeout(1500)
    # la sonda redondea s a 1 decimal: la gracia (10,5) puede leerse EXACTA —
    # se acepta >= (el estancamiento ya corre: f > 0 lo demuestra)
    check("mano anclada y estancada tras la gracia (s >= 10,5)", bool(r) and any(l and l["a"] and l["s"] >= 10.5 for l in r["limbs"][:2]), f"({r and r['limbs']})")

    # mide la SUBIDA durante ~3 s de sim (el estancamiento suma 1 %/s; la
    # tensión de colgado solo puede AÑADIR — la cota cuenta el redondeo)
    manos = [l for l in (r or {}).get("limbs", [])[:2] if l and l["a"] and l["s"] >= 10.5]
    idx = 0
    f0, s0 = manos[0]["f"], manos[0]["s"]
    shot(page, f"{OUT}/t64-1-fatiga-inicial.png")
    t0 = time.time()
    f1, s1 = f0, s0
    while time.time() - t0 < 180:
        r = rope(page)
        if r:
            m = [l for l in r["limbs"][:2] if l and l["a"]]
            if m:
                # sigue a la MISMA presa (sin resetear): s crece monotónico
                cand = max(m, key=lambda l: l["s"])
                if cand["s"] >= s0 + 2.5:
                    f1, s1 = cand["f"], cand["s"]
                    break
                f1, s1 = cand["f"], cand["s"]
        page.wait_for_timeout(1200)
    ds, df = s1 - s0, f1 - f0
    check(f"el estancamiento avanza (Δs = {ds:.1f} s)", ds >= 2.0)
    check(f"el indicador SUBE con los segundos (Δf = {df:+.2f} en {ds:.1f} s)", df >= 0.015, f"(esperado ≈ 1%/s × Δs ≈ {0.01 * ds:.3f})")
    if ds > 0:
        tasa = df / ds
        # la sonda redondea (f a 2 decimales, s a 1): tolera jitter de ±0,005;
        # la tasa EXACTA 0,01/s la fijan los tests unitarios (fatiga-tiempo).
        # BANDA: por abajo, la regla del jugador (≥ ~1%/s); por arriba, una
        # regresión a la tasa vieja (5%/s) se delataría sola.
        check(f"tasa observada {tasa:.3f}/s en banda [0,006, 0,030] (regla T69: 1 %/s)", 0.006 <= tasa <= 0.030)

    # EL AVISO NARANJA: se sigue polleando hasta que la fatiga máxima de las
    # manos cruce warnAt del pack (0,45) — la barra visible debe dispararse.
    t0 = time.time()
    fmax = 0.0
    while time.time() - t0 < 300:
        r = rope(page)
        if r:
            fmax = max((l["f"] for l in r["limbs"] if l), default=0)
            if fmax >= WARN_AT:
                break
        page.wait_for_timeout(1500)
    check(f"la fatiga cruza el aviso naranja del pack (warnAt = {WARN_AT})", fmax >= WARN_AT, f"(fmax={fmax:.2f})")
    shot(page, f"{OUT}/t64-2-fatiga-subiendo.png")
    l1 = shot(page, f"{OUT}/t64-3-fatiga-alta.png")
    check("captura de partida con luminancia válida", 8 < l1 < 250, f"(luma={l1:.0f})")
    check("sin errores JS en partida", len(errors) == 0, f"({errors[:2]})")

    # ---------- ESCENARIO C: COLGADO DE UNA SOLA MANO → EL RELOJ AL DOBLE ----------
    # T69 (petición literal): "si cada mano tiene su fatiga podemos quedar
    # colgados por 1 sola mano, solo que en ese caso la fatiga se incrementa al
    # doble de velocidad". Forzamos el agotamiento de la otra mano (fatiga 1.0
    # = suelte) y medimos la tasa del superviviente: ~0,02/s (×2).
    print("== C. UNA SOLA MANO: LA FATIGA CORRE AL DOBLE ==")
    r = rope(page)
    manos = [l for l in (r or {}).get("limbs", [])[:2] if l and l["a"]]
    check("hay manos ancladas para forzar el escenario", len(manos) >= 1)
    if len(manos) >= 1:
        # la mano a sacrificar: la MÁS fatigada que siga anclada (si solo hay
        # una, se sacrifica esa y el superviviente es la que re-agarre... no:
        # se sacrifica la MENOS fatigada SOLO si hay dos; con una, se fuerza la
        # otra a 1.0 igualmente y el ancla queda sola)
        ev(page, "__SHERPAS_DEBUG.fatigue(0, 'hand_r', 1.0)")
        # espera: a lo sumo UNA mano anclada (la forzada soltó) y que haya s crecida
        t0 = time.time()
        r = None
        while time.time() - t0 < 60:
            r = rope(page)
            if r:
                vivas = [l for l in r["limbs"][:2] if l and l["a"]]
                if len(vivas) == 1 and vivas[0]["s"] >= 1.0:
                    break
            page.wait_for_timeout(1200)
        vivas = [l for l in (r or {}).get("limbs", [])[:2] if l and l["a"]] if r else []
        check("colgado de UNA sola mano (la otra se soltó al 100%)", len(vivas) == 1, f"({vivas})")
        if len(vivas) == 1:
            solo = vivas[0]
            f0, s0 = solo["f"], solo["s"]
            t0 = time.time()
            f1, s1 = f0, s0
            while time.time() - t0 < 120:
                r = rope(page)
                if r:
                    vivas = [l for l in r["limbs"][:2] if l and l["a"]]
                    if len(vivas) != 1:
                        break  # re-agarró: la medida termina aquí
                    cand = vivas[0]
                    if cand["s"] >= s0 + 5.0:
                        f1, s1 = cand["f"], cand["s"]
                        break
                    f1, s1 = cand["f"], cand["s"]
                page.wait_for_timeout(1200)
            ds, df = s1 - s0, f1 - f0
            if ds > 0:
                tasa = df / ds
                # la tasa EXACTA (0,01×2 = 0,02/s) la fijan los tests unitarios;
                # aquí basta la regla: el doble de la base (≥ ~1,7%/s medido).
                # SIN cota superior: la tensión de colgar de UNA mano (T>0,6)
                # añade su fatiga de carga física por encima del reloj.
                check(f"tasa en solitario {tasa:.3f}/s ≥ 0,017 (el doble que la base 0,01)", tasa >= 0.017)
            else:
                check("la mano en solitario siguió estancada (Δs > 0)", False, "(sin Δs)")
    page.close()

    browser.close()

print()
if FALLOS:
    print(f"E2E T64 · {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("E2E T64 · TODO VERDE")
