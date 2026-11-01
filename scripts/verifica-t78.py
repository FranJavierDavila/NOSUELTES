#!/usr/bin/env python3
"""T78 — verificación E2E en caliente de la ronda de feedback:
1. ANILLO acompasado: fatigue(hl)=0.9 → los DOS anillos muestran f=0.9/rojo y
   pista tintada (hex ≈ arco ×0.3); fatigue(hl)=1.0 → las DOS manos sueltan en
   el mismo tick (los anillos desaparecen juntos).
2. CARAS: pin 'enfado' → active=enfadado + headHidden=true (cabeza original
   oculta); 'dudoso' → cabeza por defecto visible.
3. BOCADILLO: richSay con ánimo 'alegre' → speechTex=true; CAMBIAR el ánimo a
   mitad de la ventana → speechTex SIGUE true (la clave ya no se rompe).
4. Capturas: primer plano de la cara intercambiada (sola, sin la original) y
   bocadillo ancho con la frase.
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/?clima=clear&hora=dia"
OUT = "/home/z/my-project/download"


def alive(page):
    try:
        return page.evaluate("1") == 1
    except Exception:
        return False


def recover(page, tag):
    """Menú→tutorial→rico→caras cargadas (decisión de goto por URL: alive()
    también es True en about:blank, lección T77)."""
    if "localhost:3000" not in (page.url or ""):
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    t0 = time.time()
    aviso = 0.0
    while time.time() - t0 < 150:
        try:
            if not page.evaluate("!!window.__SHERPAS_DEBUG"):
                if time.time() - aviso > 10:
                    aviso = time.time()
                    print(f"[{tag}] sin debug aún…", flush=True)
                page.evaluate("(() => { const b = document.querySelector('button[data-a=go]'); if (b && b.offsetParent) b.click(); })()")
                page.wait_for_timeout(2000)
                continue
            rich = page.evaluate("(() => { try { return __SHERPAS_DEBUG.richFall(); } catch { return null; } })()")
            if rich and rich.get("seated"):
                f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
                if f and f.get("loaded") == 5:
                    return rich
                if time.time() - aviso > 15:
                    aviso = time.time()
                    print(f"[{tag}] sentado, caras {json.dumps(f)}", flush=True)
                page.wait_for_timeout(2000)
                continue
            for sel in ["[data-a=obNext]", "[data-a=obSkip]", "button[data-a=go]"]:
                try:
                    page.evaluate(f"(() => {{ const b = document.querySelector('{sel}'); if (b && b.offsetParent) b.click(); }})()")
                except Exception:
                    pass
        except Exception as e:
            if not alive(page) or "localhost:3000" not in (page.url or ""):
                print(f"[{tag}] contexto muerto, reload", flush=True)
                page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            elif time.time() - aviso > 15:
                aviso = time.time()
                print(f"[{tag}] eval-err {str(e)[:90]}", flush=True)
        page.wait_for_timeout(2000)
    return None


def main():
    ok = {"anillos": False, "sueltan_juntas": False, "caras": False, "bocadillo": False, "capturas": 0}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 256, "height": 192})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:150]))

        rich = recover(page, "t78")
        if not rich:
            print("RESULTADO SIN SESIÓN", json.dumps(ok))
            return 1
        print("sesión lista:", json.dumps(rich), flush=True)

        # ---------- 1. ANILLOS ACOMPASADOS ----------
        page.evaluate("__SHERPAS_DEBUG.fatigue(0, 'hand_l', 0.9)")
        page.evaluate("__SHERPAS_DEBUG.fatigue(0, 'hand_r', 0.35)")  # descompasados a propósito
        page.wait_for_timeout(400)
        rings = page.evaluate("__SHERPAS_DEBUG.gripRings()")
        print("anillos f=0.9/0.35:", json.dumps(rings.get("active")) if rings else None, flush=True)
        act = (rings or {}).get("active") or []
        fs = [a["f"] for a in act]
        hexes = {a["hex"] for a in act}
        ok["anillos"] = len(fs) == 2 and abs(fs[0] - fs[1]) < 1e-6 and fs[0] > 0.85
        # pista tintada: trackHex ≈ hex ×0.3
        if ok["anillos"] and act:
            a = act[0]
            def ch(h):
                h = h.lstrip("#")
                return [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
            c, t = ch(a["hex"]), ch(a["trackHex"])
            ok["anillos"] = all(abs(tc - cc * 0.3) < 0.06 for tc, cc in zip(t, c))
        print("anillos acompasados + pista tintada:", ok["anillos"], flush=True)

        # sueltan JUNTAS: hl a 1.0 → al tick siguiente las dos manos fuera
        page.evaluate("__SHERPAS_DEBUG.fatigue(0, 'hand_l', 1.0)")
        page.wait_for_timeout(400)
        rings2 = page.evaluate("__SHERPAS_DEBUG.gripRings()")
        ok["sueltan_juntas"] = len((rings2 or {}).get("active") or []) == 0
        print("círculo cerrado → las dos manos sueltan juntas:", ok["sueltan_juntas"], flush=True)

        # ---------- 2. CARAS ----------
        page.evaluate("__SHERPAS_DEBUG.richMood('enfado')")
        page.wait_for_timeout(300)
        f1 = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        print("pin enfado →", json.dumps(f1), flush=True)
        page.evaluate("__SHERPAS_DEBUG.richMood('dudoso')")
        page.wait_for_timeout(300)
        f2 = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        print("pin dudoso →", json.dumps(f2), flush=True)
        ok["caras"] = (f1.get("active") == "enfadado" and f1.get("headHidden") is True
                       and f2.get("active") is None and f2.get("headHidden") is False)
        print("caras: swap + cabeza original oculta/visible:", ok["caras"], flush=True)

        # ---------- 3. BOCADILLO CON TEXTO ----------
        page.evaluate("__SHERPAS_DEBUG.richMood('alegre')")
        page.wait_for_timeout(600)  # PNG del ánimo decodifica
        said = page.evaluate("__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
        page.wait_for_timeout(300)
        m1 = page.evaluate("__SHERPAS_DEBUG.richMood()")
        print("richSay:", said, "mood:", json.dumps(m1), flush=True)
        # cambiar el ánimo EN MEDIO de la ventana de habla (la clave vieja se rompía)
        page.evaluate("__SHERPAS_DEBUG.richMood('furia')")
        page.wait_for_timeout(400)
        m2 = page.evaluate("__SHERPAS_DEBUG.richMood()")
        print("tras cambiar el ánimo:", json.dumps(m2), flush=True)
        ok["bocadillo"] = bool(said) and m1.get("speechTex") is True and m2.get("speechTex") is True
        print("bocadillo con texto sobrevive al cambio de ánimo:", ok["bocadillo"], flush=True)

        # ---------- 4. CAPTURAS ----------
        try:
            # cara intercambiada EN PRIMER PLANO (pin enfado ya está)
            page.evaluate("__SHERPAS_DEBUG.richMood('enfado')")
            pel = page.evaluate("__SHERPAS_DEBUG.richFall()")
            if pel and pel.get("pelvis"):
                p = pel["pelvis"]
                page.evaluate(f"""(() => {{ const s = __SHERPAS_DEBUG.sceneObj();
                  s.camTarget.set ? s.camTarget.set({p['x']}, {p['y'] + 1.0}, {p['z']}) : (s.camTarget = {{x:{p['x']}, y:{p['y'] + 1.0}, z:{p['z']}}});
                  s.orbitYaw = 0.0; s.orbitPitch = 0.1; s.camDist = 1.35; return true; }})()""")
                page.wait_for_timeout(2500)
                page.screenshot(path=f"{OUT}/t78-cara_closeup.png")
                ok["capturas"] += 1
                print("captura closeup ok", flush=True)
                # bocadillo ancho con frase
                page.evaluate("__SHERPAS_DEBUG.richSay('¡Esto es un atraco a mano armada!')")
                page.wait_for_timeout(900)
                page.screenshot(path=f"{OUT}/t78-bocadillo_texto.png")
                ok["capturas"] += 1
                print("captura bocadillo ok", flush=True)
        except Exception as e:
            print("captura falló:", str(e)[:150], flush=True)

        print("pageerrors:", len(errs), errs[:2], flush=True)
        browser.close()

    print("RESULTADO", json.dumps(ok))
    return 0 if all(v for k, v in ok.items() if k != "capturas") else 1


if __name__ == "__main__":
    sys.exit(main())
