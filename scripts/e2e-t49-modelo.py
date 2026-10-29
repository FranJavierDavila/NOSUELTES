#!/usr/bin/env python3
"""E2E Task 49 — MODELO GLB DE LOS ESCALADORES ("escalador.glb").

Petición del jugador: "vamos a probar a cambiar el modelo de los escaladores
por un mesh nuevo escalador.glb".

Arquitectura: el esqueleto Mixamo del .glb se POSA cada frame desde las 15
partículas de física (la física ES la animación — sin clips ni retargeting).
El .glb carga en SEGUNDO PLANO con el menú; si al hacer spawn aún no llegó,
nacen cápsulas y se INTERCAMBIAN solas; si falla, cápsulas para siempre.

Pipeline: DATOS (climber.json + .glb servido) → GO → modelo LISTO y POSADO
en P0/P1 → movimiento real (subir) → capturas → 0 errores JS.
"""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
GLB_BYTES = 11841088

def probe(page):
    el = page.query_selector(".sphud .debug[data-probe]")
    if not el:
        return None
    try:
        return json.loads(el.get_attribute("data-probe"))
    except Exception:
        return None

def wait_for(page, cond, timeout_s, label, soft=False):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    if soft:
        return None
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read()
    except Exception:
        return 0, b""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # ---------- 1) DATOS: climber.json habilitado + .glb servido ENTERO ----------
    st, raw = get(f"{URL}/content/sherpas/climber.json")
    assert st == 200, "climber.json no servido"
    cfg = json.loads(raw)
    assert cfg["enabled"] is True, "modelo desactivado en climber.json"
    assert cfg["model"] == "/models/escalador.glb"
    assert len(cfg["tint"]) == 2, "tint requiere 2 jugadores"
    print(f"DATOS climber: model={cfg['model']} turnDeg={cfg.get('turnDeg', 0)} tint={cfg['tint']}")

    st, raw = get(f"{URL}/models/escalador.glb")
    assert st == 200, "el .glb no se sirve"
    assert len(raw) == GLB_BYTES, f"el .glb llega truncado ({len(raw)} ≠ {GLB_BYTES})"
    print(f"DATOS modelo: escalador.glb íntegro ({len(raw)} bytes)")

    # ---------- 2) partida ----------
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")

    # ---------- 3) MODELO: cargado, mapeado y posado en ambos jugadores ----------
    # (si llegó tarde, el intercambio cápsulas→piel es automático)
    def climber_ok():
        c = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null")
        return c if c and c.get("state") == "ready" and c.get("players") == [True, True] else None

    t0 = time.time()
    c = None
    while time.time() - t0 < 30:
        c = climber_ok()
        if c:
            break
        page.wait_for_timeout(300)
    assert c, f"el modelo no quedó listo y posado: {page.evaluate('window.__SHERPAS_DEBUG.climber && __SHERPAS_DEBUG.climber()')}"
    assert c["mapped"] >= 20, f"huesos controlados insuficientes: {c['mapped']}"
    assert not c["missing"], f"huesos ausentes: {c['missing']}"
    assert c["heightModel"] > 0.5, f"alto del modelo absurdo: {c['heightModel']}"
    # T49b: el reposo capturado debe REPRODUCIR el bind del export (error ~0).
    # Si esto se dispara, la piel saldría estirada/torcida otra vez.
    assert c.get("restError", 1) < 0.05, f"reposo no reproduce el bind: restError={c.get('restError')}"
    print(f"MODELO: state={c['state']} mapped={c['mapped']}/20 alto={c['heightModel']:.2f}u "
          f"mallas={c['meshes']} esqueletos={c['skeletons']} restError={c.get('restError', -1):.2e} players={c['players']}")
    page.wait_for_timeout(1200)  # asienta frames con la pose física activa
    page.screenshot(path=f"{OUT}/t49-0-escaladores-glb.png")
    print("CAPTURA t49-0-escaladores-glb.png")

    # ---------- 4) LA FÍSICA MANDA: los escaladores siguen las partículas ----------
    # comprobar que la pose SE MUEVE con el juego (subir real → partículas nuevas)
    before = page.evaluate("__SHERPAS_DEBUG.particles(0)")
    ok = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')")
    if not ok:
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')")
    page.wait_for_timeout(2500)
    after = page.evaluate("__SHERPAS_DEBUG.particles(0)")
    assert before and after, "sonda particles(0) sin datos"
    moved = sum(
        1 for a, b in zip(before, after)
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) > 0.05
    )
    assert moved >= 3, f"el cuerpo apenas se movió tras 'subir' ({moved}/15 partículas)"
    print(f"POSE VIVA: {moved}/15 partículas se movieron >5cm con la física")
    page.screenshot(path=f"{OUT}/t49-1-escalando-glb.png")
    print("CAPTURA t49-1-escalando-glb.png")

    # los dos escaladores siguen siendo dos modelos independientes (no gemelos pegados)
    c2 = page.evaluate("__SHERPAS_DEBUG.climber()")
    assert c2["players"] == [True, True], "perdimos un escalador tras moverse"

    # ---------- 5) sin errores JS ----------
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T49 VERDE ✅")
    browser.close()
