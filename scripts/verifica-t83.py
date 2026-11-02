#!/usr/bin/env python3
"""T83 — verificación E2E visual de los 3 arreglos del feedback:
1. La cara original (pieza_cabeza) DESAPARECE cuando hay cara nueva
   (richHeadMeshes incluía solo hijos: el nodo ES la malla → lista vacía).
2. Bocadillo SOLO con frase (sin frase visible=false) y anclado a la cabeza.
3. Capturas: cara nueva activa + bocadillo con frase pegado a la cabeza.
Memoria frágil: viewport mínimo, una sola vida, capturas tras el arranque."""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3001/?clima=clear&hora=dia"
OUT = "/tmp/render"  # T83: FUERA del proyecto — Next dev recargaba la página al
                     # ver escrituras en download/ y mataba el match a mitad


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    ok = {"arranque": False, "caras_antes": None, "pin": {}, "frase": {}, "sin_frase": None}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
        page.on("crash", lambda: print("[CRASH] pestaña muerta"))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        t0 = time.time()
        seated = False
        while time.time() - t0 < 220:
            try:
                st = page.evaluate("""(() => ({
                    debug: !!window.__SHERPAS_DEBUG,
                    go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                    skip: (() => { const s = document.querySelector('button[data-a=obSkip]'); return !!(s && (s.offsetWidth || s.offsetHeight)); })(),
                    seated: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })(),
                }))()""")
                if st.get("seated"):
                    seated = True
                    break
                if not st.get("debug"):
                    page.wait_for_timeout(1500)
                    continue
                if st.get("go"):
                    page.evaluate("document.querySelector('button[data-a=go]').click()")  # ¡GO! abre el onboarding
                elif st.get("skip"):
                    page.evaluate("document.querySelector('button[data-a=obSkip]').click()")  # saltar pasos
                print(f"[{time.time()-t0:5.1f}s]", st)
                page.wait_for_timeout(1400)
            except Exception as e:
                print("EXC", str(e)[:110])
                page.wait_for_timeout(2500)
        if not seated:
            print(json.dumps(ok, ensure_ascii=False))
            browser.close()
            return 1
        ok["arranque"] = True
        # esperar a que los 5 GLB de cara carguen (async, ~3.1 MB c/u)
        t1 = time.time()
        f = None
        while time.time() - t1 < 25:
            f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if f and f.get("loaded") == 5:
                break
            page.wait_for_timeout(600)
        ok["caras_antes"] = f
        # 1) PIN sorpresa → cara asustado + cabeza original OCULTA
        page.evaluate("__SHERPAS_DEBUG.richMood('sorpresa')")
        page.wait_for_timeout(1500)
        ok["pin"] = {
            "mood": page.evaluate("__SHERPAS_DEBUG.richMood()"),
            "faces": page.evaluate("__SHERPAS_DEBUG.richFaces()"),
        }
        # captura del rico con cara nueva (zoom razonable)
        page.set_viewport_size({"width": 420, "height": 320})
        page.wait_for_timeout(900)
        page.screenshot(path=f"{OUT}/t83-cara-activa.png")
        # 2) FRASE: bocadillo con texto anclado a la cabeza
        ok["frase"]["aceptada"] = page.evaluate("__SHERPAS_DEBUG.richSay('¡Prueba T83: bocadillo pegado a la cabeza!')")
        page.wait_for_timeout(700)
        ok["frase"]["mood"] = page.evaluate("__SHERPAS_DEBUG.richMood()")
        page.screenshot(path=f"{OUT}/t83-bocadillo.png")
        # 3) SIN FRASE: quitar pin y esperar a que la ventana cierre → visible=false
        page.evaluate("__SHERPAS_DEBUG.richMood(null)")
        page.wait_for_timeout(5000)
        ok["sin_frase"] = page.evaluate("__SHERPAS_DEBUG.richMood()")
        browser.close()
    print(json.dumps(ok, ensure_ascii=False, indent=1))
    return 0 if ok["arranque"] else 1


if __name__ == "__main__":
    sys.exit(main())
