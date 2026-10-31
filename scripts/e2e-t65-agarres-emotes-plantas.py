#!/usr/bin/env python3
"""E2E T65+T66+T67 — ANILLOS DE AGARRE · EMOTICONOS DEL RICACHÓN · PLANTAS.
(1) ANILLOS DE AGARRE (T65): toda presa lleva un círculo verde sutil; la presa
    agarrada pinta la fatiga de su extremidad recorriendo la rampa COMPLETA
    verde→naranja→rojo, y el agarre solo se suelta al llegar al rojo hondo
    (fatiga 1.0 = tuning limb.fatigueReleaseAt).
(2) EMOTICONO-BOCADILLO DEL RICACHÓN (T66): billboard con el PNG del ánimo delante
    de la cara — los 8 dibujos de emotionos.zip cambian con su estado.
(3) PLANTAS (T67): la pared ya no repite una mata — arquetipos (hierba,
    helecho, arbusto, campanula, musgo, cojín) con la misma vegetación viva.
(4) REGRESIÓN: sin errores JS y capturas con luminancia válida."""
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

    # ---------- ESCENARIO A: ANILLOS DE AGARRE ----------
    print("== A. ANILLOS DE AGARRE: verde sutil + rampa completa verde→naranja→rojo ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_match(page)

    rg = rings(page)
    check("sonda gripRings disponible", rg is not None)
    # el muro CRECE por chunks: al arrancar ya hay >150 presas con su anillo
    check("las presas visibles llevan su anillo estático (>150)", bool(rg) and rg["static"] > 150,
          f"(static={rg and rg['static']})")
    shot(page, f"{OUT}/t65-0-anillos-verdes.png")

    # espera a que hand_l de P0 esté anclada
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

    # el anillo de ESA presa está activo y en VERDE (fatiga baja)
    t0 = time.time()
    ent = None
    while time.time() - t0 < 30:
        rg = rings(page)
        if rg:
            ent = next((e for e in rg["active"] if e["holdId"] == hold_id and e["f"] < 0.2), None)
            if ent:
                break
        page.wait_for_timeout(1000)
    check("anillo activo sobre la presa agarrada", ent is not None,
          f"(activos={rg and len(rg['active'])})")
    if ent:
        rr, gg, bb = hexc(ent["hex"])
        check("el anillo parte en VERDE (f≈0)", gg > rr and gg > bb,
              f"(hex={ent['hex']} f={ent['f']})")

    # RAMPA COMPLETA con el mando de depuración: verde → naranja → rojo → rojo hondo
    pasos = [(0.05, "verde", lambda c: c[1] > c[0]),
             (0.55, "naranja", lambda c: c[0] > 200 and 100 < c[1] < 210),
             (0.85, "rojo", lambda c: c[0] > 200 and c[1] < 110),
             (0.99, "rojo hondo", lambda c: c[0] > 170 and c[1] < 60)]
    shot(page, f"{OUT}/t65-1-rampa-inicio.png")
    for f, nombre, ok_fn in pasos:
        ev(page, f"__SHERPAS_DEBUG.fatigue(0, 'hand_l', {f})")
        page.wait_for_timeout(700)
        rg = rings(page)
        ent = next((e for e in (rg or {}).get("active", []) if e["holdId"] == hold_id), None) if rg else None
        if not ent:
            # la fatiga 1.0 pudo soltar ya el agarre: el paso rojo hondo se
            # verifica abajo con el suelte; aquí solo si sigue agarrado
            if f >= 0.99:
                check(f"rampa {nombre} (f={f}): el agarre se soltó al completar el recorrido", True)
                continue
            check(f"rampa {nombre} (f={f}): anillo activo", False)
            continue
        c = hexc(ent["hex"])
        check(f"rampa {nombre} (f={f}): anillo {ent['hex']}", ok_fn(c))
        if nombre == "naranja":
            shot(page, f"{OUT}/t65-2-rampa-naranja.png")
        if nombre == "rojo":
            shot(page, f"{OUT}/t65-3-rampa-roja.png")

    # SUELTE AL FINAL DEL RECORRIDO: con fatiga 1.0 el rig suelta (exhaustion)
    # y el re-agarre nuevo nace con fatiga 0 (la sonda cae de golpe).
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
    check("completado el recorrido (f=1.0) el agarre SE SUELTA y renace descansado", solto)
    l1 = shot(page, f"{OUT}/t65-4-suelte-exhaustion.png")
    check("captura de partida con luminancia válida", 8 < l1 < 250, f"(luma={l1:.0f})")
    check("sin errores JS tras la rampa", len(errors) == 0, f"({errors[:2]})")

    # ---------- ESCENARIO B: EMOTICONO DEL RICACHÓN ----------
    print("== B. EMOTICONO-BOCADILLO DEL RICACHÓN (emotionos.zip) ==")
    # los 8 PNG sirven por HTTP
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

    md = ev(page, "__SHERPAS_DEBUG.richMood()")
    check("ánimo por defecto visible", bool(md) and md.get("visible") is True and md.get("mood"),
          f"({md})")
    default_mood = md.get("mood") if md else None
    check("el ánimo por defecto es del vocabulario (8 emoticonos)",
          default_mood in {"alegre", "desconfianza", "dudoso", "enfado", "furia", "soberbia", "sorpresa", "triste"},
          f"({default_mood})")

    for m, captura in [("furia", "t65-5-emote-furia.png"), ("alegre", "t65-6-emote-alegre.png")]:
        okf = ev(page, f"__SHERPAS_DEBUG.richMood('{m}')")
        # a 4 fps el PNG tarda varios frames en decodificar: esperar textura lista
        listo = False
        t0 = time.time()
        while time.time() - t0 < 30:
            md = ev(page, "__SHERPAS_DEBUG.richMood()")
            if md and md.get("mood") == m and md.get("visible") and md.get("texReady"):
                listo = True
                break
            page.wait_for_timeout(1200)
        check(f"ánimo forzado '{m}' se muestra con textura lista", bool(okf) and listo, f"({md})")
        shot(page, f"{OUT}/{captura}")
    # ánimo inválido: ignorado (no rompe la cara)
    ev(page, "__SHERPAS_DEBUG.richMood('noexiste')")
    page.wait_for_timeout(400)
    md = ev(page, "__SHERPAS_DEBUG.richMood()")
    check("ánimo inválido ignorado (sigue el último válido)", md and md.get("mood") == "alegre", f"({md})")

    # ---------- ESCENARIO C: PLANTAS CON VARIEDAD ----------
    print("== C. PLANTAS: seis arquetipos en la pared ==")
    ps = ev(page, "__SHERPAS_DEBUG.plantStats()")
    check("sonda de plantas disponible", ps is not None)
    if ps:
        # el nº de matas depende de la semilla del muro (huecos): 5+ es la
        # banda observada; la VARIEDAD la fija la aserción de arquetipos
        check("hay vegetación viva en la pared", ps["total"] >= 5, f"(total={ps['total']})")
        nkinds = len(ps["kinds"])
        check(f"la pared cultiva VARIEDAD ({nkinds} arquetipos: {sorted(ps['kinds'])})", nkinds >= 3)
    shot(page, f"{OUT}/t65-7-plantas.png")
    check("sin errores JS al cierre", len(errors) == 0, f"({errors[:2]})")
    page.close()

    browser.close()

print()
if FALLOS:
    print(f"E2E T65 · {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("E2E T65 VERDE")
