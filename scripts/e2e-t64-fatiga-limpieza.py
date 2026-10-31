#!/usr/bin/env python3
"""E2E T64 — ADIÓS NO SUELTES (1 jugador) + FATIGA POR TIEMPO EN EL MISMO AGARRE.
(1) MENÚ DIRECTO: la página monta SHERPAS AL LÍMITE sin lanzador; no queda ni
    rastro de "ELIGE TU ASCENSO", la tarjeta "NO SUELTES" ni el prototipo viejo.
(2) FATIGA POR TIEMPO (regla del jugador: 5 s sin variar → +5 %/s): en partida
    real, las extremidades ancladas a la misma presa ven su indicador SUBIR con
    los segundos (sonda rope: f = fatiga, s = segundos en la misma presa).
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
    page.click("button[data-a=go]")
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
    print("== B. FATIGA POR TIEMPO: 5 s SIN VARIAR → EL INDICADOR SUBE +5 %/s ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_match(page)

    # espera a que una mano esté anclada y ESTANCADA (s >= 5,5 s de sim)
    r = None
    t0 = time.time()
    while time.time() - t0 < 180:
        r = rope(page)
        if r:
            manos = [l for l in r["limbs"][:2] if l and l["a"]]
            if manos and max(l["s"] for l in manos) >= 5.5:
                break
        page.wait_for_timeout(1500)
    check("mano anclada y estancada tras la gracia (s > 5,5)", bool(r) and any(l and l["a"] and l["s"] > 5.5 for l in r["limbs"][:2]), f"({r and r['limbs']})")

    # mide la SUBIDA durante ~3 s de sim (el estancamiento suma 5 %/s; la
    # tensión de colgado solo puede AÑADIR — por eso la cota es >= 0,12)
    manos = [l for l in (r or {}).get("limbs", [])[:2] if l and l["a"] and l["s"] > 5.5]
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
    check(f"el indicador SUBE con los segundos (Δf = {df:+.2f} en {ds:.1f} s)", df >= 0.10, f"(esperado ≥ 5%/s × Δs ≈ {0.05 * ds:.2f})")
    if ds > 0:
        tasa = df / ds
        # la sonda redondea (f a 2 decimales, s a 1): tolera ±0,005 de jitter;
        # la tasa EXACTA 0,05/s la fijan los tests unitarios (fatiga-tiempo).
        check(f"tasa observada {tasa:.3f}/s ≥ 0,05/s (regla del jugador)", tasa >= 0.045)

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
    page.close()

    browser.close()

print()
if FALLOS:
    print(f"E2E T64 · {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("E2E T64 · TODO VERDE")
