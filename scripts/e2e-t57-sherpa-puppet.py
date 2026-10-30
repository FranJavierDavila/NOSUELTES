#!/usr/bin/env python3
"""E2E T57 — SHERPA.GLB POR PIEZAS: el modelo del jugador (plantilla Opción B)
sustituye al procedural. La marioneta rígida se posa con las 15 partículas:
(1) el GLB carga en modo "piezas" con las 13 piezas, (2) cada pivote coincide
con SU partícula de física ("lo visible ES la física"), (3) la pose está viva
(mueve piezas al forzar 'subir'), (4) cápsulas fuera, (5) 0 errores JS y
capturas verificadas (frame presentado)."""
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []

# pivote de pieza → índice de partícula (P) que debe ocupar EXACTAMENTE
PIVOTE_A_PARTICULA = {
    "pieza_torso": 4,            # pelvisC
    "pieza_cabeza": 0,           # head
    "pieza_brazo_sup_izq": 2,    # shL
    "pieza_antebrazo_izq": 7,    # elbowL
    "pieza_brazo_sup_der": 3,    # shR
    "pieza_antebrazo_der": 8,    # elbowR
    "pieza_muslo_izq": 5,        # hipL
    "pieza_pantorrilla_izq": 11, # kneeL
    "pieza_muslo_der": 6,        # hipR
    "pieza_pantorrilla_der": 12, # kneeR
}
TODAS_LAS_PIEZAS = set(PIVOTE_A_PARTICULA) | {"mochila", "tirante_izq", "tirante_der"}


def check(nombre, cond, detalle=""):
    tag = "OK " if cond else "FALLO"
    print(f"  [{tag}] {nombre} {detalle}")
    if not cond:
        FALLOS.append(nombre)


def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None


# SONDA SEGURA (lección de esta E2E): el objeto SherpaScene CRUDO es circular
# (Babylon) y al serializarlo el contexto muere — NUNCA devolver sceneObj();
# proyectar a booleanos/planos ANTES de cruzar el puente de Playwright.
def scene_tex_viva(page):
    try:
        return bool(page.evaluate(
            "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj() && !!__SHERPAS_DEBUG.sceneObj().strataTex"))
    except Exception:
        return False


def n_capsulas(page):
    """Nº de cápsulas procedurales vivas (ambos jugadores), sin serializar mallas."""
    expr = "(function(){try{var v=__SHERPAS_DEBUG.sceneObj().rigVisuals;if(!v)return -1;var n=0;" \
           "for(var i=0;i<2;i++){var r=v[i];if(r&&r.bones){n+=r.bones.length;}}return n;}catch(e){return -2;}})()"
    try:
        return int(page.evaluate(expr))
    except Exception:
        return -3


def screenshot_until_scene(page, path, tries=12, wait_ms=2500):
    """Captura con verificación de frame PRESENTADO (luminancia del centro,
    con techo para descartar páginas de error blancas)."""
    from PIL import Image as _Img
    stat = 0
    for i in range(tries):
        page.screenshot(path=path)
        img = _Img.open(path).convert("L")
        w, h = img.size
        centro = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
        stat = sum(centro.getdata()) / (centro.width * centro.height)
        if 32 < stat < 240:
            print(f"  frame presentado (luma centro {stat:.0f}) tras {i + 1} intentos")
            return True
        page.wait_for_timeout(wait_ms)
    print(f"  AVISO: luma centro {stat:.0f} tras {tries} intentos")
    return False


def crop_around(page, shot_path, out_path, world_pos, box=(360, 480), scale=3.0):
    pr = probe(page, "project", world_pos[0], world_pos[1], world_pos[2])
    if not pr:
        print(f"  (sin proyección para {out_path})")
        return
    img = Image.open(shot_path)
    cx, cy = int(pr["x"]), int(pr["y"])
    w, h = box
    # fuera de encuadre → aviso y no-fatal (el punto puede proyectar fuera del viewport)
    if not (-w < cx < img.width + w and -h < cy < img.height + h):
        print(f"  (punto {world_pos} proyecta fuera de encuadre: {cx},{cy} — salto {out_path})")
        return
    left, top = max(0, cx - w // 2), max(0, cy - h // 2)
    right, bottom = min(img.width, left + w), min(img.height, top + h)
    if right - left < 8 or bottom - top < 8:
        print(f"  (recorte degenerado para {out_path} — salto)")
        return
    crop = img.crop((left, top, right, bottom))
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    crop.save(out_path)
    print(f"  recorte {out_path}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",  # OOM del sandbox: WebGL en /tmp (lección T55)
        "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    consola = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: consola.append(f"{m.type}: {m.text[:300]}") if m.type == "error" else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    go = False
    for ronda in range(4):
        try:
            page.wait_for_selector("text=SHERPAS AL LÍMITE", timeout=30000)
            page.click("text=SHERPAS AL LÍMITE", timeout=8000)
        except Exception:
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            continue
        try:
            page.wait_for_selector("button[data-a=go]", timeout=120000)
            go = True
            break
        except Exception:
            print(f"  (ronda {ronda + 1}: el menú del juego no montó; recargo)")
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
    assert go, "el botón GO del menú nunca apareció"

    # WARM-UP ROBUSTO (estilo ensure_game de T55): (re)arranca la partida hasta
    # que haya estratos vivos y el modelo "piezas" READY en los DOS jugadores.
    so_tex = False
    cl = None
    t0 = time.time()
    intento = 0
    while time.time() - t0 < 120:
        intento += 1
        cl = probe(page, "climber")
        so_tex = scene_tex_viva(page)
        if so_tex and cl and cl.get("state") == "ready" and cl.get("players") == [True, True]:
            break
        # (re)lanzar: menú → GO
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=4000)
        except Exception:
            pass
        try:
            page.wait_for_selector("button[data-a=go]", timeout=6000)
            page.click("button[data-a=go]")
        except Exception:
            pass
        page.wait_for_timeout(4000)
    if not so_tex:
        page.screenshot(path="/tmp/t57-fallo-warmup.png")
        print("  DIAGNÓSTICO: GO en página =", page.locator("button[data-a=go]").count(),
              "| HUD pausa =", page.locator("[data-a]").count())
        print("  errores JS:", errors[:4], "| consola:", consola[:6])
    assert so_tex, f"escena no disponible — errores JS: {errors[:4]} consola: {consola[:6]}"
    page.wait_for_timeout(16000)
    print(f"warm-up listo en {time.time() - t0:.0f}s (intentos: {intento})")

    # ---- 1. MODELO POR PIEZAS ACTIVO ----
    print("== MODELO POR PIEZAS ==")
    cl = probe(page, "climber") or {}
    print("  climber:", cl)
    check("estado ready", cl.get("state") == "ready", f"(state={cl.get('state')}, err={cl.get('error')})")
    check("modo piezas", cl.get("mode") == "piezas")
    check("13 piezas en el .glb", cl.get("pieces") == 13, f"(pieces={cl.get('pieces')})")
    check("sin piezas ausentes", cl.get("missingPieces") == [], f"({cl.get('missingPieces')})")
    check("espejo LH neutralizado", cl.get("mirrorStripped") is True)
    check("2 jugadores con el modelo", cl.get("players") == [True, True], f"({cl.get('players')})")
    caps = n_capsulas(page)
    check("cápsulas procedurales FUERA", caps == 0, f"(cápsulas={caps})")

    # ---- 2. LO VISIBLE ES LA FÍSICA: pivotes de piezas == partículas ----
    print("== PIVOTES == PARTÍCULAS ==")
    # asentar: sin fuerza y un par de segundos para que la pose calme
    page.wait_for_timeout(4000)
    pp = probe(page, "puppetPieces") or {}
    ok_sonda = bool(pp) and pp.get("p0") and pp.get("p1")
    check("sonda de piezas disponible", ok_sonda)
    if ok_sonda:
        for p in (0, 1):
            parts = probe(page, "particles", p) or []
            pieces = pp[f"p{p}"]["pieces"]
            check(f"p{p}: 13 piezas vivas", len(pieces) == 13, f"(n={len(pieces)})")
            check(f"p{p}: mallas activas >= 13", pp[f"p{p}"]["meshes"] >= 13, f"(meshes={pp[f'p{p}']['meshes']})")
            if len(parts) == 15:
                peor = ("", 0.0)
                for nombre, idx in PIVOTE_A_PARTICULA.items():
                    pieza = pieces.get(nombre)
                    if not pieza:
                        continue
                    d = ((pieza[0] - parts[idx][0]) ** 2 + (pieza[1] - parts[idx][1]) ** 2 + (pieza[2] - parts[idx][2]) ** 2) ** 0.5
                    if d > peor[1]:
                        peor = (nombre, d)
                check(f"p{p}: pivotes sobre sus partículas (tol 8 cm)", peor[1] < 0.08, f"(peor: {peor[0]} d={peor[1]:.3f} m)")
            # la mochila va DETRÁS del torso (−z respecto del pecho): sin espejo
            mochila = pieces.get("mochila")
            torso = pieces.get("pieza_torso")
            check(f"p{p}: mochila DETRÁS del torso (z menor)", bool(mochila and torso and mochila[2] < torso[2]),
                  f"(mochila z={mochila and mochila[2]}, torso z={torso and torso[2]})")

    # ---- 3. POSE VIVA: forzar 'subir' mueve las piezas ----
    print("== POSE VIVA ==")
    antes = (probe(page, "puppetPieces") or {}).get("p0", {}).get("pieces", {})
    fired = probe(page, "force", "subir", 0)
    check("force('subir') disparada", fired is True)
    page.wait_for_timeout(3500)
    despues = (probe(page, "puppetPieces") or {}).get("p0", {}).get("pieces", {})
    movs = []
    for nombre in ("pieza_antebrazo_izq", "pieza_antebrazo_der", "pieza_torso", "pieza_cabeza"):
        a, b = antes.get(nombre), despues.get(nombre)
        if a and b:
            movs.append(((nombre), ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5))
    movs.sort(key=lambda t: -t[1])
    print("  movimientos:", [(n, round(d, 3)) for n, d in movs])
    check("las piezas se MUEVEN con la física (≥1 pieza >2 cm)", any(d > 0.02 for _, d in movs))

    # ---- 4. CAPTURAS VERIFICADAS ----
    print("== CAPTURAS ==")
    ok_general = screenshot_until_scene(page, f"{OUT}/t57-0-general-sherpa.png")
    check("frame presentado en captura general", ok_general)
    # recortes apuntados a cada escalador (pelvis de la física, proyecto mundo→pantalla)
    for p in (0, 1):
        parts = probe(page, "particles", p) or []
        if len(parts) == 15:
            pelvis = parts[4]
            crop_around(page, f"{OUT}/t57-0-general-sherpa.png",
                        f"{OUT}/t57-{p + 1}-escalador-p{p}.png", (pelvis[0], pelvis[1] + 0.35, pelvis[2]),
                        box=(340, 520), scale=2.8)
    crop_around(page, f"{OUT}/t57-0-general-sherpa.png", f"{OUT}/t57-3-pared-con-sherpas.png",
                (0, 3.4, 0.1), box=(900, 700), scale=1.35)

    # ---- 5. errores JS ----
    print("== JS ==")
    check("0 errores JS", len(errors) == 0, f"(n={len(errors)})")
    for e in errors:
        print("  ", e)
    browser.close()

print(f"RESULTADO: {'VERDE' if not FALLOS else 'ROJO'} — fallos: {FALLOS if FALLOS else 'ninguno'}")
sys.exit(0 if not FALLOS else 1)
