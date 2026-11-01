#!/usr/bin/env python3
"""Captura dedicada T69: partida de día, cámara por defecto, recorte del muro
para verificación visual de la capa climática (fisuras/pátina/líquenes)."""
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"


def ev(p, expr, default=None):
    try:
        return p.evaluate(expr)
    except Exception:
        return default


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        p = b.new_page(viewport={"width": 960, "height": 600})
        p.goto(URL + "/", wait_until="domcontentloaded")
        p.wait_for_timeout(6000)
        p.wait_for_selector("button[data-a=go]", timeout=120000)
        p.click("button[data-a=go]")
        p.wait_for_timeout(1500)
        # cerrar el tutorial COMPLETO (todas las páginas hasta que no quede UI)
        for _ in range(30):
            clicked = ev(p, """(() => {
              for (const sel of ['[data-a=obNext]', '[data-a=obDone]', '[data-a=obClose]']) {
                const b = document.querySelector(sel);
                if (b && b.offsetParent) { b.click(); return sel; }
              }
              return null;
            })()""", default=None)
            if not clicked:
                break
            p.wait_for_timeout(700)
        t0 = time.time()
        while time.time() - t0 < 150:
            if ev(p, "(function(){ try { return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope(0) : null; } catch(e){ return null; } })()"):
                break
            p.wait_for_timeout(2000)
        # esperar chunks y UI asentada
        t0 = time.time()
        while time.time() - t0 < 60:
            cl = ev(p, "(function(){ try { return __SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null; } catch(e){ return null; } })()")
            if cl and cl.get("plugins", 0) >= 6:
                break
            p.wait_for_timeout(2000)
        p.wait_for_timeout(4000)
        p.screenshot(path=f"{OUT}/t69-3-muro-dia.png")
        print("captura t69-3-muro-dia.png")
        b.close()


if __name__ == "__main__":
    main()
