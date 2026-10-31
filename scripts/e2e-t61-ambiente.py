#!/usr/bin/env python3
"""E2E T61 — AMBIENTE: huecos sellados + nevada + hora del día + PBR/HDRI + objetos que caen.
(1) MENÚ: filas nuevas Clima/Hora con vista previa en vivo (noche más oscura, nieve cayendo).
(2) PARTIDA DÍA: HDRI activo (environment true) + baseline de luminancia.
(3) NIEVE: debugForce nieve → presas encaladas (swaps>0) + captura.
(4) OBJETOS: rockfall → balística visible en sonda + subtítulos de impacto.
(5) HORA: atardecer/noche cambian cielo+sol (sonda) y la noche oscurece el frame.
(6) MACIZOS: órbitas ±75° ya no muestran el vacío (capturas para ojo humano)."""
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
    # CIELO arriba-derecha: sin HUD, sin panel del menú; es donde la hora del
    # día MÁS se nota (el frontal nocturno deja la pared jugable a propósito)
    return luma(path, 0.72, 0.02, 0.99, 0.22)


def shot(page, path, tries=10, wait_ms=2500, region="centro"):
    from PIL import Image as _Img
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
    """evaluate con reintentos (HMR/compilación puede reinstalar el hook)."""
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


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])

    # ---------- ESCENARIO A: menú con selectores y vista previa ----------
    print("== A. MENÚ: Clima/Hora + vista previa en vivo ==")
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    for ronda in range(3):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=90000)
            break
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
    page.wait_for_timeout(1500)
    clima_row = page.evaluate("!!Array.from(document.querySelectorAll('.row label')).find(l=>/Clima|Weather/.test(l.textContent))")
    check("menú muestra la fila Clima", clima_row)
    botones = page.evaluate("Array.from(document.querySelectorAll('[data-a=weathers] button, [data-a=daytimes] button')).map(b=>b.textContent.trim())")
    check("selector clima con 3 opciones", sum(1 for b in botones if "espejado" in b or "Nevada" in b or "Clear" in b or "Snow" in b) >= 3, f"({botones})")
    check("selector hora con 3 opciones", sum(1 for b in botones if "Día" in b or "Atardecer" in b or "Noche" in b or "Day" in b or "Sunset" in b or "Night" in b) >= 3)
    luma_menu_dia = shot(page, f"{OUT}/t61-0-menu-dia.png")
    # noche en vivo (vista previa del menú)
    ev(page, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=daytimes] button')).find(x=>/Noche|Night/.test(x.textContent));
      if (b) b.click();
    })()""")
    page.wait_for_timeout(4000)
    luma_menu_noche = shot(page, f"{OUT}/t61-1-menu-noche.png")
    check("la vista previa NOCTURNA oscurece el cielo del menú", luma_sky(f"{OUT}/t61-1-menu-noche.png") < luma_sky(f"{OUT}/t61-0-menu-dia.png") * 0.9,
          f"(cielo día {luma_sky(f'{OUT}/t61-0-menu-dia.png'):.0f} → noche {luma_sky(f'{OUT}/t61-1-menu-noche.png'):.0f}; en el menú el cielo apenas entra en cuadro — la prueba dura es la de partida)")
    # nevada de validación en vivo
    ev(page, """(() => {
      const b = Array.from(document.querySelectorAll('[data-a=weathers] button')).find(x=>/validar|test/.test(x.textContent));
      if (b) b.click();
    })()""")
    page.wait_for_timeout(3500)
    shot(page, f"{OUT}/t61-2-menu-nieve.png")
    g0 = dbg(page, "graphics") or {}
    check("vista previa nocturna aplicada en la escena del menú", g0.get("daytime") == "noche", f"({g0.get('daytime')})")
    check("HDRI procedural activo en el menú", g0.get("environment") is True, f"(environment={g0.get('environment')})")

    # ---------- ESCENARIO B: partida día → nieve → objetos → atardecer/noche ----------
    print("== B. PARTIDA: HDRI, nieve, objetos que caen, hora del día ==")
    page.goto(URL + "/?clima=clear&hora=dia", wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    for ronda in range(3):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
            page.wait_for_selector("button[data-a=go]", timeout=90000)
            break
        except Exception:
            page.goto(URL + "/?clima=clear&hora=dia", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
    page.click("button[data-a=go]")
    # saltar onboarding con CLICS JS (el pipeline de input real se ahoga con
    # SwiftShader y el menú pesado T61: un clic forzado puede tardar >9 s)
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
    check("partida arrancada", time.time() - t0 < 145)
    page.wait_for_timeout(13000)  # warm-up shaders + HDRI

    g = dbg(page, "graphics") or {}
    check("hora DÍA aplicada en partida", g.get("daytime") == "dia", f"({g.get('daytime')})")
    check("HDRI procedural activo (IBL)", g.get("environment") is True, f"(environment={g.get('environment')})")
    shot(page, f"{OUT}/t61-3-partida-dia.png")

    # HORA DEL DÍA en partida (ANTES de la nieve: el velo blanco de la nevada
    # ocupa el cuadro a esta altura y ensuciaría la comparación de cielo)
    dbg(page, "force", "atardecer")
    page.wait_for_timeout(3500)
    g = dbg(page, "graphics") or {}
    check("ATARDECER aplicado", g.get("daytime") == "atardecer", f"({g.get('daytime')})")
    shot(page, f"{OUT}/t61-6-atardecer.png")
    dbg(page, "force", "noche")
    page.wait_for_timeout(4000)
    g = dbg(page, "graphics") or {}
    check("NOCHE aplicada", g.get("daytime") == "noche", f"({g.get('daytime')})")
    shot(page, f"{OUT}/t61-7-noche.png")
    check("la NOCHE oscurece el cielo frente al día", luma_sky(f"{OUT}/t61-7-noche.png") < luma_sky(f"{OUT}/t61-3-partida-dia.png") * 0.5,
          f"(cielo día {luma_sky(f'{OUT}/t61-3-partida-dia.png'):.0f} → noche {luma_sky(f'{OUT}/t61-7-noche.png'):.0f})")
    p = probe_json(page)
    check("sin regresión: la partida sigue viva de noche", bool(p.get("a")) and bool(p.get("b")), f"(a={p.get('a')})")
    dbg(page, "force", "dia")  # vuelta al día para el resto del escenario
    page.wait_for_timeout(2500)

    # subir un poco para que la nieve tenga presas por encima de la cota
    for _ in range(2):
        dbg(page, "force", "subir2")
        page.wait_for_timeout(2600)

    # NIEVE a la altura del equipo (validación desde la partida)
    ok_nieve = dbg(page, "force", "nieve")
    check("debugForce('nieve') disparado", ok_nieve is True)
    page.wait_for_timeout(4500)
    p = probe_json(page)
    snow = p.get("snow") or {}
    check("nevada activa (nivel > 0.3)", snow.get("level", 0) > 0.3, f"({snow})")
    check("cota de nieve fijada a la banda actual", isinstance(snow.get("lineM"), (int, float)), f"(lineM={snow.get('lineM')})")
    si = ev(page, "(function(){var s=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj(); return s && s.getSnowInfo ? s.getSnowInfo() : null;})()")
    check("presas ENCALADAS por encima de la cota", bool(si) and si.get("swaps", 0) > 0, f"({si})")
    luma_nieve = shot(page, f"{OUT}/t61-4-nieve.png")

    # OBJETOS QUE CAEN
    ok_rf = dbg(page, "force", "rockfall")
    check("debugForce('rockfall') disparado", ok_rf is True)
    seen = None
    t0 = time.time()
    while time.time() - t0 < 8:
        p = probe_json(page)
        if (p.get("falling") or []):
            seen = p.get("falling")
            break
        page.wait_for_timeout(300)
    check("balística del objeto visible en sonda", bool(seen), f"({seen})")
    page.wait_for_timeout(700)
    shot(page, f"{OUT}/t61-5-objeto.png")
    # un segundo objeto + espera de impacto (subtítulo/contador)
    dbg(page, "force", "rockfall")
    page.wait_for_timeout(5000)
    p = probe_json(page)
    check("contador de impactos >= 1 (subtítulo/audiencia)", p.get("fallHits", 0) >= 1, f"(fallHits={p.get('fallHits')})")

    # ---------- ESCENARIO C: MACIZOS LATERALES (sellado) ----------
    print("== C. MACIZOS: la pared ya no es una lámina con vacío ==")
    for tag, yaw, pitch in [("der75", 1.31, 0.0), ("izq75", -1.31, 0.0), ("der75cabiz", 1.31, 0.55), ("izq75bajo", -1.31, -0.45)]:
        ev(page,
           f"(function(){{var s=__SHERPAS_DEBUG.sceneObj(); s.orbitIdle=-99; s.orbitYawGoal={yaw}; s.orbitYaw={yaw}; s.orbitPitchGoal={pitch}; s.orbitPitch={pitch};}})()")
        page.wait_for_timeout(1400)
        shot(page, f"{OUT}/t61-8-macizo-{tag}.png")
        print("  captura macizo", tag)
    ev(page, "(function(){var s=__SHERPAS_DEBUG.sceneObj(); s.orbitYawGoal=0; s.orbitYaw=0; s.orbitPitchGoal=0; s.orbitPitch=0;})()")
    bc = dbg(page, "baseCamp") or {}
    check("macizos laterales construidos (tris > 0)", (bc.get("massifTris") or 0) > 0, f"(massifTris={bc.get('massifTris')})")

    check("0 pageerrors en toda la sesión", len(errors) == 0, f"({errors[:2]})")
    browser.close()

print()
if FALLOS:
    print("E2E T61 con FALLOS:", FALLOS)
    sys.exit(1)
print("E2E T61 COMPLETA EN VERDE")
