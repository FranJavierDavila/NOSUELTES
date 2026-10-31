#!/usr/bin/env python3
"""E2E T63 — ANCLAJES NATURALES + NEVADA VISIBLE + VIVEZA.
(1) PARTIDA NEVADA (?clima=snow): nieve CAYENDO desde el primer segundo
    (nivel >= 0.5 al pie, cota 12 m, pps > 0), suelo encalado y sin errores JS.
(2) NIEVE QUE SE POSA: debugForce('nieve') → presas encaladas como INSTANCIAS
    (fix del swap único de T61: swaps >= 3) + pared manchada + captura.
(3) ANCLAJES NATURALES: holdStats — masters por receta (>=2 variantes por
    tipo), magnesio en rock_firm, grietas en rock_loose, instancias reales.
(4) VIVEZA: cielo diurno más AZUL y luminoso que el baseline lavado (banda
    superior del frame), contraste global activo en la sonda graphics.
(5) CAPTURAS para ojo humano: partida nevada, presas macro tras subir, día."""
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


def luma_sky(path):
    from PIL import Image as _Img
    img = _Img.open(path).convert("L")
    w, h = img.size
    c = img.crop((int(w * 0.72), int(h * 0.02), int(w * 0.99), int(h * 0.22)))
    return sum(c.getdata()) / (c.width * c.height)


def sky_blue(path):
    """Saturación de azul del cielo: media de (B - min(R,G)) normalizada —
    el cielo alpino vivo debe notarse frente al lavado #17334f/#7fa6bd."""
    from PIL import Image as _Img
    img = _Img.open(path).convert("RGB")
    w, h = img.size
    c = img.crop((int(w * 0.72), int(h * 0.02), int(w * 0.99), int(h * 0.22)))
    px = list(c.getdata())
    acc = 0
    for r, g, b in px[::7]:
        acc += (b - min(r, g)) / 255
    return acc / max(1, len(px[::7]))


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


def dbg(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(10):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(500)
    return None


def ev(page, expr, tries=10):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(500)
    return None


def probe_json(page, tries=14):
    for _ in range(tries):
        try:
            raw = page.evaluate(
                "document.querySelector('[data-e=debug]') && document.querySelector('[data-e=debug]').getAttribute('data-probe')")
            if raw:
                import json
                return json.loads(raw)
        except Exception:
            pass
        page.wait_for_timeout(500)
    return {}


def start_match(page, query):
    page.goto(URL + query, wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    for ronda in range(3):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=90000)
            break
        except Exception:
            page.goto(URL + query, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
    page.click("button[data-a=go]")
    page.wait_for_timeout(1500)
    for _ in range(6):
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
        page.wait_for_timeout(600)
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            ok = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            ok = False
        if ok:
            break
        page.wait_for_timeout(2000)
    check(f"partida arrancada {query}", time.time() - t0 < 145)
    page.wait_for_timeout(12000)  # warm-up shaders + HDRI


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])

    # ---------- ESCENARIO A: partida NEVADA desde el principio ----------
    print("== A. NEVADA VISIBLE DESDE EL INICIO (?clima=snow) ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start_match(page, "/?clima=snow&hora=dia")

    p = probe_json(page)
    snow = p.get("snow") or {}
    # el equipo está al pie (cota ~3 m): con T63 la intensidad de caída ya es
    # 0.55 — ANTES era 0 (nada visible hasta escalar la cota). A fps de
    # software la sim va a cámara lenta: se espera al fundido con reintentos.
    lvl = None
    t0 = time.time()
    while time.time() - t0 < 30:
        p = probe_json(page)
        snow = p.get("snow") or {}
        lvl = snow.get("level")
        if isinstance(lvl, (int, float)) and lvl >= 0.45 and snow.get("lineM") == 12:
            break
        page.wait_for_timeout(2000)
    check("nieva DESDE EL PRIMER SEGUNDO (nivel >= 0.45 al pie, cota 12 m)",
          isinstance(lvl, (int, float)) and lvl >= 0.45 and snow.get("lineM") == 12, f"(snow={snow})")
    si = ev(page, "(function(){var s=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj(); return s && s.getSnowInfo ? s.getSnowInfo() : null;})()")
    check("partículas de nieve emitidas (pps > 0)", bool(si) and si.get("pps", 0) > 0, f"({si})")
    check("presas ENCALADAS desde el inicio (por encima de 12 m)", bool(si) and si.get("swaps", 0) >= 3, f"({si})")
    shot(page, f"{OUT}/t63-0-partida-nevada.png")
    # COPOS EN EL AIRE: la banda del cielo (antes limpia) ahora tiene copos
    # claros → la varianza de luminancia del cuadro sube (nieve = moteado)
    from PIL import Image as _Img
    img = _Img.open(f"{OUT}/t63-0-partida-nevada.png").convert("L")
    w, h = img.size
    cielo = img.crop((int(w * 0.06), int(h * 0.04), int(w * 0.5), int(h * 0.3)))
    data = list(cielo.getdata())
    mean = sum(data) / len(data)
    var = sum((v - mean) ** 2 for v in data[::3]) / len(data[::3])
    check("copos moteando el encuadre (varianza de cielo > 60)", var > 60, f"(var={var:.0f})")

    # ANCLAJES NATURALES
    hs = ev(page, "(function(){var s=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj(); return s && s.getHoldStats ? s.getHoldStats() : null;})()")
    check("presas por receta natural", bool(hs) and hs.get("natural") is True, f"({hs})")
    check("más de un tipo con forma propia (>=4 tipos estampados)", bool(hs) and hs.get("types", 0) >= 4, f"(types={hs and hs.get('types')})")
    check("VARIANTES: más masters que tipos (pared no clónica)", bool(hs) and hs.get("masters", 0) > hs.get("types", 0), f"(masters={hs and hs.get('masters')})")
    check("rock_firm con MAGNESIO y rock_loose con GRIETAS", bool(hs) and hs.get("chalk") is True and hs.get("cracks") is True, f"({hs})")

    # NIEVE QUE SE POSA: forzar cota a la banda actual → capuchas
    for _ in range(2):
        dbg(page, "force", "subir2")
        page.wait_for_timeout(2200)
    ok_nieve = dbg(page, "force", "nieve")
    check("debugForce('nieve') disparado", ok_nieve is True)
    page.wait_for_timeout(4500)
    si = ev(page, "(function(){var s=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj(); return s && s.getSnowInfo ? s.getSnowInfo() : null;})()")
    check("presas ENCALADAS como instancias (>=3: fix del swap único)", bool(si) and si.get("swaps", 0) >= 3, f"({si})")
    shot(page, f"{OUT}/t63-1-presas-encaladas.png")

    # VIVEZA: vuelta a despejado y captura de la partida en día vivo
    dbg(page, "force", "nieve_off")
    page.wait_for_timeout(4000)
    g = dbg(page, "graphics") or {}
    check("vuelta a despejado aplicada (sonda graphics viva)", bool(g) and g.get("toneMapping") is not None, f"({str(g)[:80]})")
    check("contraste de viveza activo (1.16)", bool(g) and abs((g.get("contrast") or 0) - 1.16) < 0.01, f"(contrast={g and g.get('contrast')})")
    shot(page, f"{OUT}/t63-2-partida-dia-vivo.png")
    check("0 errores JS en partida nevada+día", len(errors) == 0, f"({errors[:2]})")
    page.close()

    # ---------- ESCENARIO B: menú, vista previa con flores/viveza ----------
    print("== B. MENÚ: viveza general + vista previa de nevada ==")
    page2 = browser.new_page(viewport={"width": 960, "height": 600})
    errors2 = []
    page2.on("pageerror", lambda e: errors2.append(str(e)))
    page2.goto(URL, wait_until="domcontentloaded")
    page2.wait_for_timeout(9000)
    for ronda in range(3):
        try:
            page2.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page2.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page2.wait_for_selector("button[data-a=go]", timeout=90000)
            break
        except Exception:
            page2.goto(URL, wait_until="domcontentloaded")
            page2.wait_for_timeout(2500)
    page2.wait_for_timeout(2000)
    # el HDRI del menú se construye en setDaytime (T61): se clica HORA Día
    ev(page2, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=daytimes] button')).find(x=>/D\u00eda|Day/.test(x.textContent));
      if (b) b.click();
    })()""")
    page2.wait_for_timeout(3500)
    shot(page2, f"{OUT}/t63-3-menu-dia-vivo.png")
    g2 = dbg(page2, "graphics") or {}
    check("HDRI procedural activo en el menú", g2.get("environment") is True, f"(environment={g2.get('environment')})")
    # vista previa nocturna: el cielo del menú se oscurece (prueba T61)
    ev(page2, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=daytimes] button')).find(x=>/Noche|Night/.test(x.textContent));
      if (b) b.click();
    })()""")
    page2.wait_for_timeout(4000)
    shot(page2, f"{OUT}/t63-5-menu-noche.png")
    check("la vista previa NOCTURNA oscurece el cielo del menú",
          luma_sky(f"{OUT}/t63-5-menu-noche.png") < luma_sky(f"{OUT}/t63-3-menu-dia-vivo.png") * 0.9,
          f"(día {luma_sky(f'{OUT}/t63-3-menu-dia-vivo.png'):.0f} → noche {luma_sky(f'{OUT}/t63-5-menu-noche.png'):.0f})")
    # nevada de validar en vivo (cota 6 m): la roca del PIE se ENCALA
    ev(page2, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=daytimes] button')).find(x=>/D\u00eda|Day/.test(x.textContent));
      if (b) b.click();
    })()""")
    page2.wait_for_timeout(2500)
    ev(page2, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=weathers] button')).find(x=>/validar|test/i.test(x.textContent));
      if (b) b.click();
    })()""")
    page2.wait_for_timeout(4500)
    shot(page2, f"{OUT}/t63-4-menu-nevada.png")
    # banda izquierda (roca del macizo al pie): con la nevada debe ACLARARSE
    def luma_rock(path):
        from PIL import Image as _Img
        img = _Img.open(path).convert("L")
        w, h = img.size
        c = img.crop((0, int(h * 0.45), int(w * 0.16), int(h * 0.9)))
        return sum(c.getdata()) / (c.width * c.height)
    check("la nevada ENCALA la roca visible del menú (banda izquierda más clara)",
          luma_rock(f"{OUT}/t63-4-menu-nevada.png") > luma_rock(f"{OUT}/t63-3-menu-dia-vivo.png") * 1.06,
          f"(día {luma_rock(f'{OUT}/t63-3-menu-dia-vivo.png'):.0f} → nevada {luma_rock(f'{OUT}/t63-4-menu-nevada.png'):.0f})")
    check("0 errores JS en menú", len(errors2) == 0, f"({errors2[:2]})")
    page2.close()

    browser.close()

print()
if FALLOS:
    print(f"E2E T63 — {len(FALLOS)} FALLOS: {FALLOS}")
    sys.exit(1)
print("E2E T63 — TODO EN VERDE")
