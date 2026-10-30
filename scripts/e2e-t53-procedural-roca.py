#!/usr/bin/env python3
"""E2E T53 — ESCALADOR PROCEDURAL RECUPERADO + ESTRATOS TRIPLANAR ACLARADOS
(petición del jugador: "recuperar el modelo original del escalador, el
procedural creado anteriormente y eliminar el personaje spider-man actual" y
"textura estratificada por encima de la actual de la roca... tonos
diferenciados y más claros según estratificado... mapas triplanares").

Comprobaciones:
  1. SKINNED RETIRADO: sonda climber → state=off, players [false,false].
  2. PROCEDURAL VIVO: rigVisuals de ambos jugadores con 13 huesos-cápsula
     + cabeza (+ mochila); 0 mallas skinned.
  3. ESTRATOS: strataTex (capa triplanar T44) no nula y aplicada a ≥1 chunk
     PBR (rockPbrCount).
  4. VISUAL: captura general + cierres de P0 (naranja) y P1 (azul) + recorte
     de roca para leer el bandeo estratificado.
  5. FÍSICA MANDA: force("subir") mueve las partículas (el muñeco es física).
  6. 0 errores JS.
"""
import time

from PIL import Image
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"


def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    expr = f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})"
    for _ in range(8):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None


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
    page.wait_for_timeout(1500)
    for _ in range(3):
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=5000)
            break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")

    # 1) SKINNED RETIRADO (T53): el adaptador T49 queda en off con cápsulas
    t0 = time.time()
    c = None
    while time.time() - t0 < 20:
        c = probe(page, "climber")
        if c:
            break
        page.wait_for_timeout(300)
    assert c is not None, "sonda climber no disponible"
    assert c["state"] == "off", f"el modelo skinned no está retirado: {c}"
    assert c["players"] == [False, False], f"hay mallas skinned vivas: {c}"
    print(f"SKINNED RETIRADO: state={c['state']} players={c['players']}")

    # 2) PROCEDURAL VIVO: 13 cápsulas por jugador + cabeza/mochila
    so = probe(page, "sceneObj")
    assert so, "sceneObj no disponible"
    rv = so.get("rigVisuals")
    assert rv and rv[0] and rv[1], f"escaladores procedurales ausentes: {bool(rv and rv[0]), bool(rv and rv[1])}"
    for p in (0, 1):
        nb = len(rv[p]["bones"])
        assert nb == 13, f"P{p}: {nb} huesos ≠ 13"
    print(f"PROCEDURAL: P0={len(rv[0]['bones'])} cápsulas P1={len(rv[1]['bones'])} cápsulas (+cabeza+mochila)")

    # 3) CAPA DE ESTRATOS TRIPLANAR activa y aplicada a la roca PBR
    st = so.get("strataTex")
    npbr = so.get("rockPbrCount")
    assert st, "la textura de estratos T44 no se generó"
    assert isinstance(npbr, (int, float)) and npbr >= 1, f"chunks PBR con estratos: {npbr}"
    print(f"ESTRATOS: capa triplanar viva, {int(npbr)} chunks PBR con ella")

    page.wait_for_timeout(1500)

    # 4) VISUAL: general + cierres de los DOS procedurales + roca estratificada
    page.screenshot(path=f"{OUT}/t53-0-general.png")
    w0 = probe(page, "waist", 0)
    w1 = probe(page, "waist", 1)
    print(f"cinturas: P0={w0} P1={w1}")
    crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-1-p0-procedural.png",
                (w0["x"], w0["y"] + 0.9, w0["z"]))
    crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-2-p1-procedural.png",
                (w1["x"], w1["y"] + 0.9, w1["z"]))
    # roca: un punto de pared ALTO y despejado por encima del escalador 0
    holds = probe(page, "holds") or []
    if holds:
        h = max(holds, key=lambda q: q["y"])
        crop_around(page, f"{OUT}/t53-0-general.png", f"{OUT}/t53-3-roca-estratos.png",
                    (h["x"], min(h["y"] + 0.35, h["y"] + 0.35), 0.10), box=(420, 560), scale=2.2)

    # 5) LA FÍSICA MANDA (el procedural es física pura)
    before = probe(page, "particles", 0)
    ok = probe(page, "force", "subir")
    if not ok:
        ok = probe(page, "force", "subir2")
    page.wait_for_timeout(2500)
    after = probe(page, "particles", 0)

    def triples(pv):
        if not pv:
            return []
        if isinstance(pv[0], dict):
            return [(p["x"], p["y"], p["z"]) for p in pv]
        if isinstance(pv[0], (list, tuple)):
            return [(p[0], p[1], p[2]) for p in pv]
        return [(pv[i], pv[i + 1], pv[i + 2]) for i in range(0, len(pv) - 2, 3)]

    bt, at = triples(before), triples(after)
    moved = sum(1 for a, b in zip(bt, at)
                if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 0.01)
    print(f"POSE VIVA: {moved}/15 partículas se movieron")
    assert moved >= 10, "la física no movió al personaje"
    page.screenshot(path=f"{OUT}/t53-4-escalando.png")
    w0b = probe(page, "waist", 0)
    crop_around(page, f"{OUT}/t53-4-escalando.png", f"{OUT}/t53-5-p0-escalando.png",
                (w0b["x"], w0b["y"] + 0.9, w0b["z"]))

    # 6) sin errores JS
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T53 VERDE")
    browser.close()
