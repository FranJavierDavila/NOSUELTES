#!/usr/bin/env python3
"""Diagnóstico T69 — la nevada ACTIVA el clima en vivo de la piedra:
arranca una partida con nevada y sondea __SHERPAS_DEBUG.clima(): wetness y
frost deben subir de 0 (easing ~1 s) y la capa debe estar en los chunks."""
import sys
import time

from playwright.sync_api import sync_playwright  # noqa: E402

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def shot(page, path, tries=10, wait_ms=2500):
    page.wait_for_timeout(wait_ms)
    for _ in range(tries):
        page.screenshot(path=path)
        return path
    return None


def ev(page, expr, tries=12):
    for _ in range(tries):
        try:
            v = page.evaluate(expr)
        except Exception:
            v = None
        if v is not None:
            return v
        page.wait_for_timeout(500)
    return None


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--disable-gpu-sandbox",
        ])
        page = browser.new_page(viewport={"width": 960, "height": 600})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL + "/", wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
        # clic en ¡GO! con REINTENTO seguro (arranque frío: la primera
        # compilación puede tragarse el primer clic; nunca evaluar durante la
        # transición de navegación)
        t0 = time.time()
        while time.time() - t0 < 150:
            try:
                if page.query_selector("button[data-a=go]"):
                    page.click("button[data-a=go]")
            except Exception:
                pass
            page.wait_for_timeout(4000)
            r = None
            try:
                r = page.evaluate("(function(){ try { return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope(0) : null; } catch(e){ return null; } })()")
            except Exception:
                r = None  # navegación en curso: reintentar
            if r:
                break
        print("  [i] partida arrancada (rope responde)")
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
        # nevada: forzar el clima del match por la sonda (si existe) o esperar
        # el ciclo — el modo más fiable es pedir la nevada por debug
        # esperar a que la partida esté VIVA (chunks construidos) antes de forzar
        t0 = time.time()
        nplug = 0
        while time.time() - t0 < 90:
            cl0 = ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null; })()", tries=2)
            nplug = (cl0 or {}).get("plugins", 0)
            if nplug >= 4:
                break
            page.wait_for_timeout(2000)
        check("partida viva (chunks de roca construidos)", nplug >= 4, f"(plugins={nplug})")
        ok = ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force ? __SHERPAS_DEBUG.force('nieve') : null; })()")
        check("force('nieve') disponible (intensidad a pleno)", bool(ok), f"({ok})")
        page.wait_for_timeout(9000)
        cl = None
        si = None
        t0 = time.time()
        while time.time() - t0 < 30:
            cl = ev(page, "(function(){ return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null; })()", tries=2)
            si = ev(page, "(function(){var s=window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj(); return s && s.getSnowInfo ? s.getSnowInfo() : null;})()", tries=2)
            if cl and (cl["wetness"] > 0.15 or cl["frost"] > 0.15):
                break
            page.wait_for_timeout(1200)
        print(f"  [i] getSnowInfo: {si}")
        check("sonda clima disponible", cl is not None, f"({cl})")
        if cl:
            check("capa aplicada a los chunks", cl["active"] and cl["plugins"] >= 1, f"(plugins={cl['plugins']})")
            check("NEVADA → wetness sube (piedra húmeda)", cl["wetness"] > 0.15, f"(wet={cl['wetness']})")
            check("NEVADA → frost sube (hielo en fisuras)", cl["frost"] > 0.15, f"(frost={cl['frost']})")
        shot(page, f"{OUT}/t69-2-clima-nevada.png")
        check("sin errores JS", len(errors) == 0, f"({errors[:2]})")
        page.close()
        browser.close()
    print()
    if FALLOS:
        print(f"DIAG T69 clima · {len(FALLOS)} FALLOS: {FALLOS}")
        sys.exit(1)
    print("DIAG T69 clima · FIN (ver wet/frost arriba)")


if __name__ == "__main__":
    main()
