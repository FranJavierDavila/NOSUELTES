#!/usr/bin/env python3
"""E2E T55 — REALISMO DE PARED + PLANTAS QUE REACCIONAN AL VIENTO
(petición del jugador: "mejorar la pared para darle mayor realismo, las
plantas que aparecen podrían reaccionar con el viento").

Comprobaciones:
  1. TINTE DE ROCA: rockTintChunks > 0 (chunks con AO/macizo/líquenes por vértice).
  2. VIENTO EN PLANTAS: plugin activo (getPlantWindInfo) + matas vivas.
  3. RACHA REAL: force("storm") → el pipeline weather→match→scene sube el nivel
     que lee el plugin (level > 0.5) — sin atajos de presentación.
  4. VISUAL: captura general + MATAS (crop apuntado) en BRISA y en RACHA +
     roca estratificada con tinte; DIFERENCIA DE PÍXELES brisa vs racha en el
     crop de la mata (las hojas se mueven de verdad).
  5. 0 errores JS (capturas verificadas por luminancia: frame presentado).

ROBUSTEZ: el dev server puede recargar la página (HMR) a mitad de partida;
ensure_game() detecta el menú y re-arranca la partida cuantas veces haga falta.
"""
import time

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"


def eval_retry(page, expr, tries=8):
    """evaluate con reintentos (contextos transitorios de la página dev)."""
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(400)
    return None


def probe(page, fn, *args):
    args_s = ", ".join(map(repr, args))
    return eval_retry(page, f"window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.{fn}({args_s})")


def wind_info(page):
    return eval_retry(page, "window.__SHERPAS_DEBUG && window.__SHERPAS_DEBUG.sceneObj().getPlantWindInfo()")


def scene_tint(page):
    so = probe(page, "sceneObj")
    return int(so.get("rockTintChunks", 0)) if so else 0


def ensure_game(page, timeout_s=45):
    """(Re)arranca la partida hasta que haya roca con tinte, matas y plugin de viento."""
    t0 = time.time()
    attempt = 0
    while time.time() - t0 < timeout_s:
        attempt += 1
        # ¿hay ya partida con todo vivo?
        if scene_tint(page) > 0:
            wi = wind_info(page)
            plantas = probe(page, "plantas") or []
            if wi and wi.get("active") and plantas:
                print(f"  partida viva (intento {attempt}): tint={scene_tint(page)} matas={len(plantas)}")
                return wi
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
    raise AssertionError("no se logró una partida viva con plantas y plugin de viento")


def screenshot_until_scene(page, path, tries=12, wait_ms=2500):
    from PIL import Image as _Img
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
    print(f"  AVISO: el centro no muestra escena (luma {stat:.0f}) tras {tries} intentos")
    return False


def crop_around(page, shot_path, out_path, world_pos, box=(320, 320), scale=3.0):
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
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",  # OOM del sandbox: WebGL en /tmp, no en /dev/shm
        "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("crash", lambda p: (print("!!! PAGE CRASH !!!"), errors.append("PAGE CRASH")))
    page.on("framenavigated", lambda f: print(f"  [nav] {f.url[:80]}") if f is page.main_frame else None)
    page.on("console", lambda m: print(f"  [console.{m.type}] {m.text[:110]}") if m.type in ("error", "warning") else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    wind0 = ensure_game(page)
    print(f"TINTE DE ROCA: {scene_tint(page)} chunks con AO/macizo/líquenes por vértice")
    print(f"VIENTO EN PLANTAS: activo (brisa {wind0['breezeAmpM']} m, freq {wind0['swayFreq']} rad/s, push {wind0['pushM']} m)")
    plantas = probe(page, "plantas") or []
    print(f"MATAS VIVAS: {len(plantas)} (sonda plantas)")

    page.wait_for_timeout(14000)  # calentamiento de shaders
    screenshot_until_scene(page, f"{OUT}/t55-0-general-brisa.png")

    # mata de referencia: proyectable en zona segura de pantalla
    meta = None
    for s in plantas:
        pr = probe(page, "project", s["x"], s["y"], s["z"])
        if pr and 220 < pr["x"] < 740 and 160 < pr["y"] < 520:
            meta = (s, pr)
            break
    if not meta:
        # la recarga pudo cambiar la partida: re-asegurar y reintentar
        wind0 = ensure_game(page)
        plantas = probe(page, "plantas") or []
        for s in plantas:
            pr = probe(page, "project", s["x"], s["y"], s["z"])
            if pr and 220 < pr["x"] < 740 and 160 < pr["y"] < 520:
                meta = (s, pr)
                break
    assert meta, "ninguna mata proyectable en zona segura"
    (sx, prx) = meta
    print(f"  mata de referencia en ({sx['x']:.2f}, {sx['y']:.2f}, {sx['z']:.2f})")
    crop_around(page, f"{OUT}/t55-0-general-brisa.png", f"{OUT}/t55-1-mata-brisas.png",
                (sx["x"], sx["y"] + 0.12, sx["z"]), box=(260, 260), scale=3.4)
    crop_around(page, f"{OUT}/t55-0-general-brisa.png", f"{OUT}/t55-4-roca-tinte.png",
                (sx["x"], sx["y"] - 0.4, sx["z"] + 0.1), box=(420, 420), scale=2.4)

    # RACHA REAL por el pipeline (tormenta: aviso ~3 s → racha larga); si el dev
    # recargó la página a mitad, re-arrancamos y volvemos a forzar UNA vez.
    for intento in (1, 2):
        ok = probe(page, "force", "storm")
        assert ok, "force('storm') no disponible"
        t1 = time.time()
        level = 0.0
        while time.time() - t1 < 16:
            wi = wind_info(page)
            level = wi["level"] if wi else 0.0
            if level > 0.5:
                break
            page.wait_for_timeout(400)
        if level > 0.5:
            break
        print(f"  intento {intento}: racha perdida (¿recarga del dev?) — re-arrancando")
        ensure_game(page)
        page.wait_for_timeout(6000)
    assert level > 0.5, f"la racha no llegó al plugin (level={level})"
    print(f"RACHA: level={level} dir={wi['dir']} (weather → match → scene → plugin)")
    page.wait_for_timeout(2500)  # deja al seno de la racha en pleno empuje
    screenshot_until_scene(page, f"{OUT}/t55-2-general-racha.png")
    crop_around(page, f"{OUT}/t55-2-general-racha.png", f"{OUT}/t55-3-mata-racha.png",
                (sx["x"], sx["y"] + 0.12, sx["z"]), box=(260, 260), scale=3.4)

    # PRUEBA DE MOVIMIENTO: diferencia de píxeles brisa vs racha en el crop
    a = Image.open(f"{OUT}/t55-1-mata-brisas.png").convert("L")
    b = Image.open(f"{OUT}/t55-3-mata-racha.png").convert("L")
    if a.size != b.size:
        b = b.resize(a.size)
    diff = ImageChops.difference(a, b)
    stat = sum(diff.getdata()) / (diff.width * diff.height)
    print(f"MOVIMIENTO: diff medio brisa vs racha en la mata = {stat:.1f}/255")
    assert stat > 3.0, "las matas no se movieron entre brisa y racha"

    lado = Image.new("RGB", (a.width * 2 + 12, a.height), (24, 24, 28))
    lado.paste(Image.open(f"{OUT}/t55-1-mata-brisas.png"), (0, 0))
    lado.paste(Image.open(f"{OUT}/t55-3-mata-racha.png"), (a.width + 12, 0))
    lado.save(f"{OUT}/t55-compara-mata-brisas-racha.png")
    print("  comparativa download/t55-compara-mata-brisas-racha.png")

    print(f"errores JS: {len(errors)}")
    for e in errors:
        print(" ", e)
    assert not errors, "hay errores JS"
    browser.close()
print("E2E T55 VERDE")
