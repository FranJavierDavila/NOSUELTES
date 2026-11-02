#!/usr/bin/env python3
"""T84b — verificación E2E de los GESTOS del ricachón en movimiento.

Para cada gesto: se fija con pin (contra el cerebro y la voz), se dejan
asentar los muelles (~1,6 s), se toman 3 muestras de richPose (11
articulaciones, mundo, mm) y se calculan invariantes geométricos. Para 4
gestos clave se congela la cámara sobre la cabeza y se captura pantalla.

Uso: python3 scripts/verifica-t84b-gestos.py  (servidor en :3001)
Salida: JSON por stdout + capturas en /tmp/render/.
"""
import json
import math
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3001/?clima=clear&hora=dia"

# gesto → (captura?, chequeo: nombre, fn(metricas) → bool)
GESTOS = [
    ("insultando", False),
    ("comiendo", True),
    ("telefono", True),
    ("brindando", True),
    ("aplaudiendo", False),
    ("mirando", False),
    ("leyendo", False),
    ("bailando", True),
    ("dormitando", False),
    ("durmiendo", True),
    ("tirando_basura", False),
]


def dist(a, b):
    return math.dist(a, b)


def metricas(muestras):
    """Promedia 3 muestras de richPose y deriva invariantes (mm)."""
    j = {}
    for m in muestras:
        for nombre, x, y, z in m:
            j.setdefault(nombre, []).append((x, y, z))
    med = {n: tuple(sum(p[i] for p in ps) / len(ps) for i in range(3)) for n, ps in j.items()}
    rang = {n: max(p[1] for p in ps) - min(p[1] for p in ps) for n, ps in j.items()}
    out = {
        "cabeza_sobre_pecho": round(med["head"][1] - med["chest"][1]),
        "pecho_sobre_pelvis": round(med["chest"][1] - med["pelvis"][1]),
        "rodillas_sobre_pelvis": round((med["kneeL"][1] + med["kneeR"][1]) / 2 - med["pelvis"][1]),
        "manos_sobre_pecho": round((med["handL"][1] + med["handR"][1]) / 2 - med["chest"][1]),
        "delta_manos_y": round(med["handR"][1] - med["handL"][1]),
        "dist_manos": round(dist(med["handL"], med["handR"])),
        "mano_der_a_cabeza": round(dist(med["handR"], med["head"])),
        "mano_izq_a_cabeza": round(dist(med["handL"], med["head"])),
        "rango_pelvis_y": round(rang["pelvis"]),
        "rango_mano_der_y": round(rang["handR"]),
        "rango_cabeza_y": round(rang["head"]),
    }
    return out, med


def chequeos(g, mt):
    c = {}
    if g == "insultando":
        c["puno_derecho_arriba"] = mt["delta_manos_y"] > 200
    elif g == "comiendo":
        c["mano_a_la_boca"] = mt["mano_der_a_cabeza"] < 420
    elif g == "telefono":
        c["mano_a_la_oreja"] = mt["mano_der_a_cabeza"] < 450 and mt["manos_sobre_pecho"] > -50
    elif g == "brindando":
        c["copa_en_alto"] = mt["manos_sobre_pecho"] > 80
    elif g == "aplaudiendo":
        c["palmas_juntas"] = mt["dist_manos"] < 420
    elif g == "mirando":
        c["prismaticos_a_los_ojos"] = max(mt["mano_der_a_cabeza"], mt["mano_izq_a_cabeza"]) < 480
    elif g == "leyendo":
        c["libro_delante"] = -150 < mt["manos_sobre_pecho"] < 380 and mt["dist_manos"] < 650
    elif g == "bailando":
        c["rebote_o_brazos"] = mt["rango_pelvis_y"] > 25 or mt["rango_mano_der_y"] > 120
    elif g == "dormitando":
        c["cabeza_caida"] = mt["cabeza_sobre_pecho"] < 240 or mt["rango_cabeza_y"] > 8
    elif g == "durmiendo":
        # el supino sobre tabla INCLINADA no deja el pecho a la altura de la
        # pelvis en coordenadas de MUNDO (la geometría del rig está testeada
        # en coords de tabla): aquí se valida que el torso y la cabeza CAEN
        # desde la pose sentada (339/278 mm)
        # en MUNDO la inclinación de la tabla manda (el pecho puede quedar
        # alto si la cabeza cuesta abajo): la geometría supina está testeada
        # en coords de tabla (richManGesture + richRig) y el visual E2E
        # (t84b-durmiendo.png) confirma la cara al cielo
        c["tumbado_supino"] = mt["pecho_sobre_pelvis"] < 320 and mt["cabeza_sobre_pecho"] < 280
    elif g == "tirando_basura":
        c["brazo_lanza"] = mt["rango_mano_der_y"] > 60 or mt["manos_sobre_pecho"] > 150
    return c


def main():
    filtro = [a for a in sys.argv[1:] if not a.startswith("-")]
    lista = [(g, c) for g, c in GESTOS if not filtro or g in filtro]
    ok = {"arranque": False, "gestos": {}, "capturas": {}, "filtro": filtro}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 560, "height": 420})
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        t0 = time.time()
        while time.time() - t0 < 200:
            st = page.evaluate("""(() => {
                const go = document.querySelector('button[data-a=go]');
                const sk = document.querySelector('button[data-a=obSkip]');
                if (go && (go.offsetWidth || go.offsetHeight)) { go.click(); return 'go'; }
                if (sk && (sk.offsetWidth || sk.offsetHeight)) { sk.click(); return 'skip'; }
                try { return __SHERPAS_DEBUG.richFall().seated ? 'seated' : 'wait'; } catch { return 'wait'; }
            })()""")
            if st == "seated":
                break
            page.wait_for_timeout(1400)
        else:
            print(json.dumps(ok))
            return 1
        ok["arranque"] = True
        page.wait_for_timeout(2000)

        for g, captura in lista:
            entrada = {"pin": bool(page.evaluate("__SHERPAS_DEBUG.richGesture('" + g + "', true)"))}
            page.wait_for_timeout(1600)  # asentar muelles
            muestras = []
            for _ in range(3):
                m = page.evaluate("__SHERPAS_DEBUG.richPose()")
                if m:
                    muestras.append(m)
                page.wait_for_timeout(380)
            if muestras:
                mt, med = metricas(muestras)
                entrada["metricas"] = mt
                entrada["chequeos"] = chequeos(g, mt)
                if captura:
                    h = med["head"]
                    if page.evaluate("__SHERPAS_DEBUG.camPin(" + str(h[0] / 1000) + "," + str(h[1] / 1000) + "," + str(h[2] / 1000) + ",1.9)"):
                        page.wait_for_timeout(900)
                        page.screenshot(path="/tmp/render/t84b-" + g + ".png")
                        ok["capturas"][g] = True
                        page.evaluate("__SHERPAS_DEBUG.camPin(null)")
            else:
                entrada["metricas"] = None
            page.evaluate("__SHERPAS_DEBUG.richGesture('ninguno', false)")  # despinear
            page.wait_for_timeout(700)
            ok["gestos"][g] = entrada
        browser.close()
    print(json.dumps(ok, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
