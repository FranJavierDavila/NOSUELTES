#!/usr/bin/env python3
"""T84 — verificación E2E visual del rig articulado + caras visibles.

1. CARA: pin sorpresa → active + headHidden (isVisible) + faceVisible (la cara
   nueva tiene mallas encendidas colgando de la cabeza: el setEnabled del padre
   ya NO la apaga). Primer plano con la cámara apuntada a la cabeza (project).
2. ANIMACIÓN: amplitud de movimiento de las articulaciones (richPose) en
   REPOSO (respiración/ruido > 0 pero pequeño) y en GESTO (exaltado: las manos
   suben > 0.3 m; insultando: el puño sube). Sin rig las manos no se moverían.
3. Capturas: primer plano de la cara nueva + gesto exaltado + gesto insultando.
"""
import json
import os
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3001/?clima=clear&hora=dia"
OUT = "/tmp/render"


def espera_seated(page, tope=220):
    t0 = time.time()
    while time.time() - t0 < tope:
        try:
            st = page.evaluate("""(() => ({
                debug: !!window.__SHERPAS_DEBUG,
                go: (() => { const b = document.querySelector('button[data-a=go]'); return !!(b && (b.offsetWidth || b.offsetHeight)); })(),
                skip: (() => { const s = document.querySelector('button[data-a=obSkip]'); return !!(s && (s.offsetWidth || s.offsetHeight)); })(),
                seated: (() => { try { const r = __SHERPAS_DEBUG.richFall(); return !!(r && r.seated); } catch { return false; } })(),
            }))()""")
            if st.get("seated"):
                return True
            if not st.get("debug"):
                page.wait_for_timeout(1500)
                continue
            if st.get("go"):
                page.evaluate("document.querySelector('button[data-a=go]').click()")
            elif st.get("skip"):
                page.evaluate("document.querySelector('button[data-a=obSkip]').click()")
            page.wait_for_timeout(1400)
        except Exception as e:
            print("EXC", str(e)[:110])
            page.wait_for_timeout(2500)
    return False


def primer_plano(page, nombre, dx=0.0, dy=0.12, dz=0.0, dist_=1.6):
    """Apunta la cámara a la cabeza del rico (proyección pantalla + target)."""
    pos = page.evaluate(f"""(() => {{
        const p = __SHERPAS_DEBUG.richPose();
        if (!p) return null;
        const head = p[0].slice(1);
        return head;
    }})()""")
    if not pos:
        return None
    hx, hy, hz = pos[0] / 1000 + dx, pos[1] / 1000 + dy, pos[2] / 1000 + dz
    ok = page.evaluate(f"__SHERPAS_DEBUG.camPin({hx}, {hy}, {hz}, {dist_})")
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/{nombre}.png")
    return ok


def main():
    os.makedirs(OUT, exist_ok=True)
    ok = {"arranque": False, "caras": None, "pin": None, "capturas": {},
          "idle": None, "exaltado": None, "insultando": None}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--enable-unsafe-swiftshader",
        ])
        page = browser.new_page(viewport={"width": 480, "height": 360})
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        if not espera_seated(page):
            print(json.dumps(ok, ensure_ascii=False))
            browser.close()
            return 1
        ok["arranque"] = True
        # caras cargadas
        t1 = time.time()
        f = None
        while time.time() - t1 < 30:
            f = page.evaluate("__SHERPAS_DEBUG.richFaces()")
            if f and f.get("loaded") == 5:
                break
            page.wait_for_timeout(600)
        ok["caras"] = f
        # 1) PIN sorpresa → cara asustado VISIBLE + cabeza original oculta
        page.evaluate("__SHERPAS_DEBUG.richMood('sorpresa')")
        page.wait_for_timeout(1800)
        ok["pin"] = page.evaluate("__SHERPAS_DEBUG.richFaces()")
        # primer plano de la cara (cámara apuntada a la cabeza)
        page.set_viewport_size({"width": 560, "height": 420})
        ok["capturas"]["cara"] = primer_plano(page, "t84-cara-primer-plano", dy=0.10, dist_=1.7)
        # 2) ANIMACIÓN: amplitud en reposo (respiración/ruido)
        page.evaluate("__SHERPAS_DEBUG.richMood(null)")
        page.evaluate("__SHERPAS_DEBUG.richGesture('ninguno')")
        page.wait_for_timeout(1300)

        def amplitud(min_muestras=5, tope_s=8.0, paso=160):
            # a 4 fps cada evaluate tarda ~0.5-1 s: la ventana es por MUESTRAS,
            # no por tiempo de pared (una ventana corta no llega ni a 3)
            muestras = []
            t0 = time.time()
            while len(muestras) < min_muestras and time.time() - t0 < tope_s:
                m = page.evaluate("""(() => {
                    const p = __SHERPAS_DEBUG.richPose();
                    if (!p) return null;
                    const por = (n) => p.find((r) => r[0] === n).slice(1);
                    return { head: por('head'), handL: por('handL'), handR: por('handR'), pelvis: por('pelvis') };
                })()""")
                if m:
                    muestras.append(m)
                page.wait_for_timeout(paso)
            if len(muestras) < min_muestras:
                return None
            def rango(clave, eje):
                vs = [m[clave][eje] for m in muestras]
                return max(vs) - min(vs)
            return {
                "n": len(muestras),
                "head_mm": {"x": rango("head", 0), "y": rango("head", 1), "z": rango("head", 2)},
                "handL_mm": {"x": rango("handL", 0), "y": rango("handL", 1)},
                "handR_mm": {"x": rango("handR", 0), "y": rango("handR", 1)},
                "pelvis_mm": {"x": rango("pelvis", 0), "y": rango("pelvis", 1)},
                "handL_y_mm": [m["handL"][1] for m in muestras],
            }

        ok["idle"] = amplitud()
        # 3) GESTO exaltado: las manos suben > 0.3 m desde el reposo
        page.evaluate("__SHERPAS_DEBUG.richGesture('exaltado', true)")
        page.wait_for_timeout(1800)
        ex = amplitud()
        if ex:
            ex["subida_mano_mm"] = max(ex["handL_y_mm"]) - max(ok["idle"]["handL_y_mm"]) if ok["idle"] else None
        ok["exaltado"] = ex
        ok["capturas"]["exaltado"] = primer_plano(page, "t84-exaltado", dy=0.0, dist_=2.2)
        # 4) GESTO insultando: puño derecho ARRIBA, izquierdo en la cadera →
        # handR.y − handL.y > 0.3 m (verificación numérica de la postura)
        page.evaluate("__SHERPAS_DEBUG.richGesture('insultando', true)")
        page.wait_for_timeout(1800)
        ins = amplitud()
        ok["insultando"] = ins
        ok["postura_insultando"] = page.evaluate("""(() => {
            const p = __SHERPAS_DEBUG.richPose();
            if (!p) return null;
            const por = (n) => p.find((r) => r[0] === n)[2];
            return { handR_y: por('handR'), handL_y: por('handL'), delta: por('handR') - por('handL') };
        })()""")
        ok["capturas"]["insultando"] = primer_plano(page, "t84-insultando", dy=0.0, dist_=2.2)
        # volver a reposo y restaurar cámara
        page.evaluate("__SHERPAS_DEBUG.richGesture('ninguno')")
        browser.close()
    print(json.dumps(ok, ensure_ascii=False, indent=1))
    return 0 if ok["arranque"] else 1


if __name__ == "__main__":
    sys.exit(main())
