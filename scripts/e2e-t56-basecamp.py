#!/usr/bin/env python3
"""E2E T56 — BASE CAMP: faldones de continuidad lateral + pedriz de piedra +
cabaña sherpa + CAÍDA REALISTA del ricachón (aterriza en el pedriz con
impacto, polvo proporcional y tabla descargada). Con capturas verificadas."""
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
FALLOS = []


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


def screenshot_until_scene(page, path, tries=12, wait_ms=2500):
    """Captura con verificación de frame PRESENTADO (luminancia del centro)."""
    from PIL import Image as _Img
    stat = 0
    for i in range(tries):
        page.screenshot(path=path)
        img = _Img.open(path).convert("L")
        w, h = img.size
        centro = img.crop((int(w * 0.30), int(h * 0.35), int(w * 0.70), int(h * 0.80)))
        stat = sum(centro.getdata()) / (centro.width * centro.height)
        if stat > 32:
            print(f"  frame presentado (luma centro {stat:.0f}) tras {i + 1} intentos")
            return True
        page.wait_for_timeout(wait_ms)
    print(f"  AVISO: centro oscuro (luma {stat:.0f}) tras {tries} intentos")
    return False


def crop_around(page, shot_path, out_path, world_pos, box=(360, 480), scale=3.0):
    pr = probe(page, "project", world_pos[0], world_pos[1], world_pos[2])
    if not pr:
        print(f"  (sin proyección para {out_path})")
        return
    img = Image.open(shot_path)
    cx, cy = int(pr["x"]), int(pr["y"])
    w, h = box
    left, top = max(0, cx - w // 2), max(0, cy - h // 2)
    right, bottom = min(img.width, left + w), min(img.height, top + h)
    crop = img.crop((left, top, right, bottom))
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    crop.save(out_path)
    print(f"  recorte {out_path}")


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    # PRECARGA: en frío turbopack compila home + bundle de Babylon (lento con
    # SwiftShader). Click al juego y espera LARGA al menú con re-cargas.
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
    page.click("button[data-a=go]")

    # WARM-UP (shaders en frío con SwiftShader ~4 fps; primer build puede tardar más)
    so = None
    t0 = time.time()
    while time.time() - t0 < 60:
        so = probe(page, "sceneObj")
        if so and so.get("rigVisuals") and so.get("strataTex"):
            break
        page.wait_for_timeout(500)
    assert so and so.get("rigVisuals"), "escena no disponible"
    page.wait_for_timeout(18000)
    print(f"warm-up listo en {time.time() - t0:.0f}s")

    # ---- 1. BASE CAMP construido ----
    print("== BASE CAMP ==")
    bc = probe(page, "baseCamp")
    print("  baseCamp:", bc)
    check("pedriz construido", bool(bc) and bc.get("screeTris", 0) > 1000, f"(screeTris={bc and bc.get('screeTris')})")
    check("faldones construidos", bool(bc) and bc.get("spurTris", 0) > 400, f"(spurTris={bc and bc.get('spurTris')})")
    check("rocas sueltas sembradas", bool(bc) and bc.get("rocks", 0) >= 6, f"(rocks={bc and bc.get('rocks')})")
    check("cabaña con piezas", bool(bc) and bc.get("cabinPieces", 0) >= 14, f"(piezas={bc and bc.get('cabinPieces')})")
    check("banderines de rezo (9)", bool(bc) and bc.get("flags", 0) == 9)
    check("humo de chimenea activo", bool(bc) and bc.get("smoke") is True)
    check("viento en banderines activo", bool(bc) and bc.get("flagWindActive") is True)

    # ---- 2. CAPTURAS: base completa + cierres ----
    print("== CAPTURAS ==")
    ok_general = screenshot_until_scene(page, f"{OUT}/t56-0-base-camp.png")
    check("frame presentado en captura general", ok_general)
    crop_around(page, f"{OUT}/t56-0-base-camp.png", f"{OUT}/t56-1-cabana.png", (2.15, 1.15, 1.9), box=(420, 520), scale=2.6)
    crop_around(page, f"{OUT}/t56-0-base-camp.png", f"{OUT}/t56-2-faldon-der.png", (4.6, 3.2, -0.75), box=(460, 620), scale=2.2)
    crop_around(page, f"{OUT}/t56-0-base-camp.png", f"{OUT}/t56-3-faldon-izq.png", (-4.6, 3.2, -0.75), box=(460, 620), scale=2.2)

    # ---- 3. CAÍDA REALISTA del ricachón ----
    print("== CAÍDA DEL RICACHÓN ==")
    rf0 = probe(page, "richFall")
    print("  richFall inicial:", rf0)
    check("sin caída previa", bool(rf0) and rf0.get("fell") is False and rf0.get("seated") is True)
    y0 = rf0["pelvis"]["y"] if rf0 else None
    fired = probe(page, "force", "caida_rico")
    check("caida_rico disparada", fired is True)
    # poll agresivo del IMPACTO (el polvo dura ~0.9 s: hay que cazarlo)
    rf = None
    t1 = time.time()
    while time.time() - t1 < 30:
        rf = probe(page, "richFall")
        if rf and rf.get("impactDone"):
            break
        page.wait_for_timeout(90)
    check("impacto contra el pedriz", bool(rf) and rf.get("impactDone") is True, f"(t={time.time() - t1:.1f}s)")
    if rf:
        print("  richFall al impacto:", rf)
        check("ricachón despedido de la tabla", rf.get("seated") is False)
        drop = (y0 - rf["pelvis"]["y"]) if y0 is not None else 0
        check("cayó de verdad hacia el suelo", drop > 0.4, f"(Δy={drop:.2f} m)")
        page.screenshot(path=f"{OUT}/t56-4-impacto-polvo.png")
        print("  captura del impacto con polvo")
    page.wait_for_timeout(1200)
    rf2 = probe(page, "richFall")
    if rf2:
        print("  richFlow asentado:", rf2)
        check("tendido en el pedriz (y<0.7)", rf2["pelvis"]["y"] < 0.7, f"(y={rf2['pelvis']['y']})")
        check("asentado (vel<3 m/s)", rf2.get("speed", 99) < 3.0, f"(speed={rf2.get('speed')})")
        check("dentro de la franja de caída (|x|<4.5)", abs(rf2["pelvis"]["x"]) < 4.5, f"(x={rf2['pelvis']['x']})")
    page.screenshot(path=f"{OUT}/t56-5-tendido-suelo.png")
    print("  captura del ricachón tendido")
    crop_around(page, f"{OUT}/t56-5-tendido-suelo.png", f"{OUT}/t56-6-tendido-cierre.png",
                (rf2["pelvis"]["x"] if rf2 else 0.5, 0.4, -1.05), box=(520, 380), scale=2.4)

    # ---- 4. errores JS ----
    print("== JS ==")
    check("0 errores JS", len(errors) == 0, f"(n={len(errors)})")
    for e in errors:
        print("  ", e)
    browser.close()

print(f"RESULTADO: {'VERDE' if not FALLOS else 'ROJO'} — fallos: {FALLOS if FALLOS else 'ninguno'}")
sys.exit(0 if not FALLOS else 1)
