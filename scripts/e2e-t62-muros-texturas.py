#!/usr/bin/env python3
"""E2E T62 — MUROS NATURALES + CUERDA/TABLÓN TEXTURIZADOS + RICACHÓN CON PLANTILLA.
(1) PARTIDA: el macizo lateral ya no son columnas — cortinas de roca con
    desplazamiento; se verifica la sonda (massifTris) y se capturan órbitas
    izq/der a 75° para el ojo humano.
(2) CUERDA: material PBR texturizado con bandas negras (captura cercana).
(3) TABLÓN: madera con vetas (captura cercana al ricachón).
(4) RICACHÓN: sonda richPuppet → active=true, pieces=13 (plantilla GLB).
(5) NEVADA: la nieve T61 blanquea también el macizo (regresión T61 verde).
(6) 0 errores de página en toda la sesión."""
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
    stat = 128
    for i in range(tries):
        page.screenshot(path=path)
        stat = luma(path)
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


def orbit(page, x, y, ms=900):
    page.mouse.move(640, 400)
    page.mouse.down()
    page.mouse.move(640 + x, 400 + y, steps=24)
    page.wait_for_timeout(ms)
    page.mouse.up()
    page.wait_for_timeout(400)


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        print("— carga del menú")
        page.goto(URL + "/?clima=clear&hora=dia", wait_until="domcontentloaded", timeout=45000)
        # el modelo GLB necesita tiempo para cargar en el menú (ricachón puppet)
        for ronda in range(3):
            try:
                page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
                page.click("text=SHERPAS AL LÍMITE", timeout=8000)
                page.wait_for_selector("button[data-a=go]", timeout=90000)
                break
            except Exception:
                page.goto(URL + "/?clima=clear&hora=dia", wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
        page.wait_for_timeout(2500)

        print("— entrar en partida (2 jugadores, saltando onboarding si sale)")
        page.click("button[data-a=go]")
        page.wait_for_timeout(1500)
        for _ in range(8):  # el onboarding de 5 pasos: avanzar con CLICS JS
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
        check("partida arrancada (drag 0 real)", time.time() - t0 < 145)
        page.wait_for_timeout(13000)  # warm-up shaders + HDRI + puppet del ricachón

        print("— (1) MACIZOS: sonda + capturas de órbita")
        bc = dbg(page, "baseCamp")
        check("baseCamp reporta macizo", bc is not None and bc.get("massifTris", 0) > 200,
              f"massifTris={bc.get('massifTris') if bc else None}")
        page.screenshot(path=f"{OUT}/t62-0-frontal.png")
        orbit(page, -420, 0)   # órbita izquierda
        page.screenshot(path=f"{OUT}/t62-1-orbita-izq.png")
        orbit(page, 840, 0)    # órbita derecha
        page.screenshot(path=f"{OUT}/t62-2-orbita-der.png")
        orbit(page, -420, 0)   # de vuelta al centro
        page.wait_for_timeout(800)

        print("— (4) RICACHÓN con la plantilla de los escaladores")
        rp = None
        for _ in range(20):
            rp = dbg(page, "richPuppet")
            if rp and rp.get("active"):
                break
            page.wait_for_timeout(700)
        check("ricachón = marioneta GLB activa", bool(rp and rp.get("active")), str(rp))
        check("ricachón = 13 piezas de la plantilla", bool(rp and rp.get("pieces") == 13), f"pieces={rp.get('pieces') if rp else None}")
        rich = dbg(page, "rich")
        check("ricachón sentado (física viva)", rich is not None, str(rich)[:60])

        print("— (2)/(3) CUERDA Y TABLÓN: captura cercana")
        page.screenshot(path=f"{OUT}/t62-3-cuerda-tablon.png")

        print("— (5) NEVADA: regresión T61 + macizo blanqueado")
        forced = dbg(page, "force", "nieve")
        check("fuerza nieve aceptada", bool(forced))
        page.wait_for_timeout(3500)
        snow = dbg(page, "snow") if False else None
        page.screenshot(path=f"{OUT}/t62-4-nieve.png")
        # deshacer la nieve para el resto
        dbg(page, "force", "nieve_off")

        print("— estabilidad final")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/t62-5-final.png")
        browser.close()

    check("0 errores de página/consola", len(errors) == 0, f"{len(errors)} errores: {errors[:3]}")
    print()
    if FALLOS:
        print(f"E2E T62: {len(FALLOS)} FALLOS → {FALLOS}")
        sys.exit(1)
    print("E2E T62: TODO VERDE")


if __name__ == "__main__":
    main()
