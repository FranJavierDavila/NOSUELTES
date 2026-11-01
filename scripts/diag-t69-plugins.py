#!/usr/bin/env python3
"""Diagnóstico T69 — estado POR-PLUGIN de la capa climática con nevada forzada.
Un ÚNICO clic en ¡GO! (repetirlo REINICIA la partida y el sondeo no converge) y
todas las evaluaciones protegidas (la navegación destruye contextos al vuelo)."""
import json
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"


def ev(p, expr, default=None):
    try:
        return p.evaluate(expr)
    except Exception:
        return default


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        p = b.new_page(viewport={"width": 800, "height": 600})
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(URL + "/", wait_until="domcontentloaded")
        p.wait_for_timeout(6000)
        p.wait_for_selector("button[data-a=go]", timeout=120000)
        p.click("button[data-a=go]")
        p.wait_for_timeout(1500)
        # saltar onboarding (rope no responde con el tutorial abierto)
        for _ in range(8):
            if ev(p, """(() => {
              const b = document.querySelector('[data-a=obNext]');
              if (!b || !b.offsetParent) return false;
              b.click();
              return true;
            })()""", default=False):
                p.wait_for_timeout(600)
            else:
                break
        t0 = time.time()
        vivo = False
        while time.time() - t0 < 150:
            # match VIVO = debugForce responde true/false (no false-por-ausencia
            # es ambiguo) → usamos el clima del MATCH: si state.match existe,
            # sceneObj es su escena; la sonda snowInfo con lineY fina lo delata.
            r = ev(p, "(function(){ try { return window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.rope ? __SHERPAS_DEBUG.rope(0) : null; } catch(e){ return null; } })()")
            if r:
                vivo = True
                break
            p.wait_for_timeout(2000)
        print(f"  [i] partida arrancada (rope responde): {vivo}")
        if not vivo:
            print(f"  [!] errores JS: {errors[:3]}")
            print("  [!] sin partida: abortando diag")
            b.close()
            return
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
        fr = ev(p, "(function(){ try { return window.__SHERPAS_DEBUG.force('nieve'); } catch(e){ return 'ERR:'+e; } })()")
        print(f"  [i] force('nieve') → {fr}")
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
        print("errores JS:", errors[:3])
        b.close()


if __name__ == "__main__":
    main()
