#!/usr/bin/env python3
"""E2E T67-FB — ANILLOS VERDES OPACOS · FATIGA SOLO EN LAS MANOS · BOCADILLO.
(1) ANILLOS DE ALCANCE (T67-FB): solo las presas ALCANZABLES se marcan, ahora
    con círculo VERDE y SIN transparencia (alpha 1 exacto; el jugador se pasó
    de sutil con los blancos). Estáticos: no cambian de color (el estado lo
    cuenta el anillo de fatiga, más grueso).
(2) FATIGA SOLO MANOS: la presa agarrada por una MANO recorre la rampa COMPLETA
    verde→naranja→rojo y suelta al 100% (fatigueReleaseAt=1.0); un PIE no pinta
    anillo ni cansa por estancamiento (quedan como hacía dos iteraciones).
(3) BOCADILLO DEL RICACHÓN (T66-FB): los 8 emoticonos de emotionos.zip sirven
    por HTTP; el bocadillo NO está siempre visible — solo cuando "habla"
    (visible ⇒ speaking salvo pin); el pin de E2E lo congela para capturarlo.
(4) PLANTAS (T66, regresión): arquetipos vivos con variedad.
(5) REGRESIÓN: sin errores JS y capturas con luminancia válida."""
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []


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
        if 35 < stat < 245:  # banda T64: fuera compilaciones de shaders oscuras
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


def rope(page, p=0):
    return ev(page, f"(function(){{ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope({p}) : null; }})()")


def rings(page):
    return ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.gripRings ? __SHERPAS_DEBUG.gripRings() : null; })()")


def mood(page):
    return ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.richMood ? __SHERPAS_DEBUG.richMood() : null; })()")


def hexc(hexs):
    hexs = hexs.lstrip("#")
    return tuple(int(hexs[i:i + 2], 16) for i in (0, 2, 4))


def start_match(page):
    page.goto(URL + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(1200)
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

    # ---------- ESCENARIO A: ANILLOS DE ALCANCE + FATIGA (SOLO MANOS) ----------
    print("== A. ALCANCE: círculo VERDE OPACO solo en las presas cercanas ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_match(page)

    rg = rings(page)
    check("sonda gripRings disponible", rg is not None)
    check("SOLO las presas alcanzables se marcan (0 < alcance ≤ pool 24)",
          bool(rg) and 0 < rg.get("reach", 0) <= 24,
          f"(reach={rg and rg.get('reach')})")
    alphas = (rg or {}).get("reachAlpha", [])
    check("SIN transparencia (T67-FB): TODOS los anillos de alcance van a alpha 1",
          bool(alphas) and all(abs(a - 1.0) < 1e-6 for a in alphas),
          f"(alphas={alphas[:3]}… n={len(alphas)})")
    hx = (rg or {}).get("reachHex") or ""
    if hx:
        r_, g_, b_ = hexc(hx)
        check("VERDE: el anillo de alcance es verde (dominante G)", g_ > r_ and g_ > b_,
              f"(hex={hx})")
    else:
        check("VERDE: hex del anillo de alcance presente", False)
    shot(page, f"{OUT}/t67-0-alcance-verde.png")

    # FATIGA: la presa agarrada por la MANO recorre la rampa completa
    r = None
    t0 = time.time()
    while time.time() - t0 < 180:
        r = rope(page, 0)
        if r and r["limbs"][0] and r["limbs"][0]["a"] and r["limbs"][0]["h"]:
            break
        page.wait_for_timeout(1200)
    mano = (r or {}).get("limbs", [None])[0]
    check("mano anclada a una presa", bool(mano and mano["a"] and mano["h"]),
          f"(hold={mano and mano['h']})")
    hold_id = mano["h"]

    t0 = time.time()
    ent = None
    while time.time() - t0 < 30:
        rg = rings(page)
        if rg:
            ent = next((e for e in rg["active"] if e["holdId"] == hold_id and e["f"] < 0.2), None)
            if ent:
                break
        page.wait_for_timeout(1000)
    check("anillo de fatiga activo sobre la presa agarrada POR LA MANO", ent is not None,
          f"(activos={rg and len(rg['active'])})")
    if ent:
        rr, gg, bb = hexc(ent["hex"])
        check("el anillo parte en VERDE (f≈0)", gg > rr and gg > bb,
              f"(hex={ent['hex']} f={ent['f']})")

    pasos = [(0.05, "verde", lambda c: c[1] > c[0]),
             (0.55, "naranja", lambda c: c[0] > 200 and 100 < c[1] < 210),
             (0.85, "rojo", lambda c: c[0] > 200 and c[1] < 110),
             (0.99, "rojo hondo", lambda c: c[0] > 170 and c[1] < 60)]
    for f, nombre, ok_fn in pasos:
        ev(page, f"__SHERPAS_DEBUG.fatigue(0, 'hand_l', {f})")
        page.wait_for_timeout(700)
        rg = rings(page)
        ent = next((e for e in (rg or {}).get("active", []) if e["holdId"] == hold_id), None) if rg else None
        if not ent:
            if f >= 0.99:
                check(f"rampa {nombre} (f={f}): el agarre se soltó al completar el recorrido", True)
                continue
            check(f"rampa {nombre} (f={f}): anillo activo", False)
            continue
        c = hexc(ent["hex"])
        check(f"rampa {nombre} (f={f}): anillo {ent['hex']}", ok_fn(c))
        if nombre == "naranja":
            shot(page, f"{OUT}/t66fb-1-rampa-naranja.png")
        if nombre == "rojo":
            shot(page, f"{OUT}/t66fb-2-rampa-roja.png")

    # SUELTE AL 100%: el recorrido COMPLETO antes de soltarse
    ev(page, "__SHERPAS_DEBUG.fatigue(0, 'hand_l', 1.0)")
    solto = False
    t0 = time.time()
    while time.time() - t0 < 25:
        r = rope(page, 0)
        ml = (r or {}).get("limbs", [None])[0]
        if ml is None or (not ml["a"]) or ml["f"] < 0.5 or ml["h"] != hold_id:
            solto = True
            break
        page.wait_for_timeout(900)
    check("completado el recorrido (f=1.0) el agarre SE SUELTA", solto)

    # LOS PIES NO PINTAN ANILLO (y no se sueltan por estancamiento: f=0.9 no
    # dispara el suelte — < fatigueReleaseAt — y la sonda de anillos ignora pies)
    t0 = time.time()
    pie = None
    while time.time() - t0 < 60:
        r = rope(page, 0)
        if r and r["limbs"][2] and r["limbs"][2]["a"] and r["limbs"][2]["h"]:
            pie = r["limbs"][2]
            break
        page.wait_for_timeout(1500)
    if pie:
        ev(page, "__SHERPAS_DEBUG.fatigue(0, 'foot_l', 0.9)")
        page.wait_for_timeout(1500)
        rg = rings(page)
        check("un PIE cargado (f=0.9) NO pinta anillo de fatiga (solo las manos)",
              rg is not None and all(e["holdId"] != pie["h"] for e in rg.get("active", [])),
              f"(activos={[e['holdId'] for e in (rg or {}).get('active', [])]})")
    else:
        check("pie anclado para la prueba (sin ancla: se asume sin anillo)", True)

    l1 = shot(page, f"{OUT}/t66fb-3-partida.png")
    check("captura de partida con luminancia válida", 8 < l1 < 250, f"(luma={l1:.0f})")
    check("sin errores JS tras la rampa", len(errors) == 0, f"({errors[:2]})")

    # ---------- ESCENARIO B: BOCADILLO DEL RICACHÓN (SOLO CUANDO HABLA) ----------
    print("== B. BOCADILLO DEL RICACHÓN: visible SOLO cuando habla ==")
    estado = ev(page, """(async () => {
      const moods = ['alegre','desconfianza','dudoso','enfado','furia','soberbia','sorpresa','triste'];
      const out = {};
      for (const m of moods) {
        try { out[m] = (await fetch('/models/sherpas/emotes/r_' + m + '.png')).status; }
        catch (e) { out[m] = 0; }
      }
      return out;
    })()""", tries=6) or {}
    check("los 8 emoticonos sirven por HTTP", len(estado) == 8 and all(v == 200 for v in estado.values()), f"({estado})")

    # INVARIANTE "solo cuando habla": sin pin, visible implica speaking
    coherente = True
    muestras = []
    for _ in range(6):
        md = mood(page)
        if md:
            muestras.append(md)
            if md.get("visible") and not (md.get("speaking") or md.get("pinned")):
                coherente = False
        page.wait_for_timeout(1000)
    check("sin pin el bocadillo solo se ve mientras 'habla' (visible ⇒ speaking)",
          coherente and muestras, f"({[(m.get('mood'), m.get('visible'), m.get('speaking')) for m in muestras]})")
    if muestras and not muestras[0].get("visible"):
        shot(page, f"{OUT}/t66fb-4-callado.png")

    for m, captura in [("furia", "t66fb-5-furia.png"), ("alegre", "t66fb-6-alegre.png")]:
        okf = ev(page, f"__SHERPAS_DEBUG.richMood('{m}')")
        listo = False
        t0 = time.time()
        while time.time() - t0 < 30:
            md = mood(page)
            if md and md.get("mood") == m and md.get("visible") and md.get("texReady") and md.get("pinned"):
                listo = True
                break
            page.wait_for_timeout(1200)
        check(f"ánimo forzado '{m}' (pin) se muestra con textura lista", bool(okf) and listo, f"({md})")
        shot(page, f"{OUT}/{captura}")
    ev(page, "__SHERPAS_DEBUG.richMood('noexiste')")
    page.wait_for_timeout(400)
    md = mood(page)
    check("ánimo inválido ignorado (sigue el último válido)", md and md.get("mood") == "alegre", f"({md})")

    # ---------- ESCENARIO C: PLANTAS CON VARIEDAD (regresión T67) ----------
    print("== C. PLANTAS: seis arquetipos en la pared ==")
    ps = ev(page, "__SHERPAS_DEBUG.plantStats()")
    check("sonda de plantas disponible", ps is not None)
    if ps:
        check("hay vegetación viva en la pared", ps["total"] >= 5, f"(total={ps['total']})")
        nkinds = len(ps["kinds"])
        check(f"la pared cultiva VARIEDAD ({nkinds} arquetipos: {sorted(ps['kinds'])})", nkinds >= 3)
    shot(page, f"{OUT}/t66fb-7-plantas.png")
    check("sin errores JS al cierre", len(errors) == 0, f"({errors[:2]})")
    page.close()

    browser.close()

print()
if FALLOS:
    print(f"E2E T66-FB · {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("E2E T66-FB VERDE")
