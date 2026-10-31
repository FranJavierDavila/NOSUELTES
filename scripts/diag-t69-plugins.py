#!/usr/bin/env python3
"""Diagnóstico T69 — estado POR-PLUGIN de la capa climática con nevada forzada.
Todas las evaluaciones van protegidas (la navegación del clic en ¡GO! destruye
contextos a mitad de sondeo)."""
import json
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"


def ev(p, expr, default=None):
    try:
        return page.evaluate(expr)
    except Exception:
        return default


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        p = b.new_page(viewport={"width": 800, "height": 600})
        p.goto(URL + "/", wait_until="domcontentloaded")
        p.wait_for_timeout(6000)
        t0 = time.time()
        while time.time() - t0 < 150:
            try:
                if p.query_selector("button[data-a=go]"):
                    p.click("button[data-a=go]")
            except Exception:
                pass
            p.wait_for_timeout(4000)
            if ev(p, "(function(){ try { return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope(0) : null; } catch(e){ return null; } })()"):
                break
        print("  [i] partida arrancada (rope responde)")
        # esperar chunks
        t0 = time.time()
        nplug = 0
        while time.time() - t0 < 90:
            cl = ev(p, "(function(){ try { return window.__SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null; } catch(e){ return null; } })()")
            nplug = (cl or {}).get("plugins", 0)
            if nplug >= 4:
                break
            p.wait_for_timeout(2000)
        print(f"  [i] chunks: plugins={nplug}")
        ev(p, "(function(){ window.__SHERPAS_DEBUG.force('nieve'); return true; })()")
        time.sleep(10)
        out = ev(p, """(function(){
          var cl = window.__SHERPAS_DEBUG.clima ? __SHERPAS_DEBUG.clima() : null;
          var si = (function(){var s=__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj(); return s && s.getSnowInfo ? s.getSnowInfo() : null;})();
          return { clima: cl, snow: si };
        })()""", default={})
        cl = out.get("clima") or {}
        pp = cl.get("perPlugin") or []
        print("snow:", out.get("snow"))
        print("plugins:", cl.get("plugins"), "freezeY(clima):", cl.get("freezeY"))
        print("perPlugin:", json.dumps(pp[:10]))
        b.close()


if __name__ == "__main__":
    main()
