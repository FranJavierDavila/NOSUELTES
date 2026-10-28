#!/usr/bin/env python3
"""E2E Task 38 — GRITO REAL del ricachón + RUTAS POR DATOS + JUICE RESTANTE.
Petición del jugador:
  - Audio REAL subido ("Cabronesss.m4a"): al caer el ricachón suena SU grabación
    (cd0e9f33.mp3 / 3b901aa6.mp3 = 62829 B) + humo de furia sobre su cabeza.
  - Rutas por datos (roadmap): el plan activo (wall_gen.route.plans) fija el
    patrón de cada tramo (juntos/separados/libre) y CICLA hasta la cima.
  - Voz + juice restante: chispas ámbar del chicote al capturar y viñeta de
    peligro proporcional a la tensión (colgado a UNA mano = peligro real).
Pipeline: spawn (sonda plan/fx/vignette) → viñeta (soltar pie+pie+mano de B con
arrastres reales a punto sin imán → cuelga de UNA mano → tensión ≈ 1,05) →
reset subir2 (banda 1 = "juntos" del plan) → caida de B (chicote + CHISPAS) →
caida_rico (grito real 200 + 62829 B + humo de furia).
"""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"
GRITO_ES = "/audio/rico/es/cd0e9f33.mp3"
GRITO_BYTES = 62829  # el fichero EXACTO del jugador (m4a → mp3 normalizado)

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

def sub_txt(page):
    try:
        return (page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or "").strip()
    except Exception:
        return ""

def bubbles_txt(page):
    """Las burbujas APILAN todos los gritos vivos (el subtítulo único lo
    sustituye el insulto del banco en <100 ms — t35 ya lo documentó)."""
    try:
        return (page.eval_on_selector(".sphud [data-e=bubbles]", "el => el.textContent") or "").strip()
    except Exception:
        return ""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    grito_responses = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: grito_responses.append((r.status, len(r.body())) if GRITO_ES in r.url else None))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}")
    print(f"SONDA fx={p.get('fx')}  vignette={p.get('vignette')}")

    # 1) RUTAS POR DATOS: plan activo + patrón de los primeros grupos
    assert p.get("route", {}).get("plan") == "ascenso_clasico", f"plan activo incorrecto: {p.get('route')}"
    pg = p["route"]["planGroups"]
    print(f"RUTA plan=ascenso_clasico  grupos={pg}")
    assert pg[0] == "libre", "el grupo 0 (arranque) debe ser libre"
    assert pg[1] == "juntos", f"el plan empieza juntos (grupo 1): {pg}"
    assert pg[2] == "separados" and pg[3] == "separados", f"tras juntos×2, separados×2: {pg}"
    assert p.get("fx") == {"spark": 0, "rage": 0}, f"contadores de juice deben nacer a 0: {p.get('fx')}"
    assert p.get("vignette", 1) == 0, f"viñeta nace invisible: {p.get('vignette')}"
    page.screenshot(path=f"{OUT}/t38-0-spawn-ruta.png")

    # 2) VIÑETA DE PELIGRO: soltar a B pie+pie+mano con arrastres reales a
    #    puntos sin imán (mecánica "mano libre cuelga", t32) → cuelga de UNA
    #    mano → tensión ≈ 1,05-1,2 (> warnAt 0,85) → viñeta roja pulsante.
    px = lambda pct: page.viewport_size["width"] * pct / 100.0
    py = lambda pct: page.viewport_size["height"] * pct / 100.0

    def soltar(page, limb_key, offsets):
        """Arrastra la extremidad a un punto SIN imán → queda libre."""
        for intento in range(6):
            q = probe(page)
            limbs = {f"{l['p']}_{l['l']}": l for l in q["limbs"]}
            if limb_key not in limbs:
                return True
            src = limbs[limb_key]
            page.mouse.move(px(src["sx"]), py(src["sy"]))
            page.mouse.down()
            page.wait_for_timeout(110)
            freed = False
            for dxp, dyp in offsets:
                page.mouse.move(px(src["sx"]) + dxp, py(src["sy"]) + dyp, steps=8)
                page.wait_for_timeout(120)
                qd = probe(page)
                if qd and qd.get("dragReach") and not qd["dragReach"]["magnet"]:
                    freed = True
                    break
            page.mouse.up()
            if freed:
                return True
            page.wait_for_timeout(600)
        return False

    ok_foot_l = soltar(page, "1_foot_l", ((-40, 190), (40, 190), (-90, 150), (90, 150)))
    ok_foot_r = soltar(page, "1_foot_r", ((40, 190), (-40, 190), (90, 150), (-90, 150)))
    print(f"SOLTAR pies  foot_l={ok_foot_l} foot_r={ok_foot_r}")
    q = wait_for(page, lambda q: q["rope"][1]["s"] == "climbing" and q["hands"][1]["grips"] >= 2, 8, "B colgado de 2 manos")
    ok_hand = soltar(page, "1_hand_r", ((-270, 30), (270, 30), (-190, 120), (190, 120), (0, 200)))
    assert ok_hand, "no se pudo soltar la mano de B"
    # La ventana a UNA mano puede ser breve (tensión >1 espiral a sobrecarga y
    # la cuerda lo recoge: jugable y legítimo) — se sondea DESDE YA a 60 ms.
    vin2 = 0.0
    t_b = 0.0
    saw_one_hand = False
    t0 = time.time()
    while time.time() - t0 < 6:
        q = probe(page)
        if q:
            if q["hands"][1]["grips"] == 1:
                saw_one_hand = True
            vin2 = max(vin2, q.get("vignette", 0))
            t_b = max(t_b, max(l.get("t", 0) for l in q["limbs"] if l["p"] == 1))
        if saw_one_hand and vin2 > 0.15 and time.time() - t0 > 0.8:
            break
        page.wait_for_timeout(60)
    print(f"VIÑETA  nivel colgado a una mano={vin2:.2f}  tensión máx B={t_b:.2f}  una mano={saw_one_hand}")
    page.screenshot(path=f"{OUT}/t38-1-vineta-peligro.png")
    assert saw_one_hand, "B no llegó a colgarse de una sola mano"
    assert t_b > 0.85, f"B colgado a una mano debe tener tensión > 0,85: {t_b}"
    assert vin2 > 0.15, f"la viñeta no se encendió colgado a una mano: {vin2}"

    # reset: el equipo vuelve a colgarse arriba (el plan sigue ahí)
    for intento in range(4):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), "force subir2"
        hi = wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 8, 14, "re-colgado en alto", soft=True)
        if hi and abs(hi["a"]["y"] - hi["b"]["y"]) < 0.45:
            page.wait_for_timeout(1200)
            break
    q = probe(page)
    print(f"RUTA EN VIVO  banda={q['route']['band']}  patrón={q['route']['pattern']}")
    # el patrón vivo debe ser el del PLAN para su grupo (patternBands=2)
    grp = q["route"]["band"] // 2
    esperado = q["route"]["planGroups"][grp] if grp < len(q["route"]["planGroups"]) else None
    assert esperado is None or q["route"]["pattern"] == esperado, \
        f"patrón vivo {q['route']['pattern']} ≠ plan {esperado} en banda {q['route']['band']}"
    page.screenshot(path=f"{OUT}/t38-2-ruta-juntos.png")

    # 3) CHISPAS DEL CHICOTE: B cae → la cuerda AGARRA → estallido ámbar
    caught = None
    for intento in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)"), "force caida B"
        t0 = time.time()
        while time.time() - t0 < 6:
            q = probe(page)
            if q and q["rope"][1]["s"] == "caught":
                caught = q
                break
            page.wait_for_timeout(90)
        if caught and caught["fx"]["spark"] >= 1:
            break
        caught = None
        page.wait_for_timeout(1800)  # B haula y re-agarra: re-intento
    assert caught, "la caída de B no fue atrapada por la cuerda"
    print(f"CHICOTE  drop={caught['rope'][1]['drop']} m  fx={caught['fx']}")
    assert caught["fx"]["spark"] >= 1, "no saltaron las chispas del chicote"
    page.screenshot(path=f"{OUT}/t38-3-chispas-chicote.png")

    # 4) GRITO REAL: el ricachón se despeña → SU grabación (200, 62829 B) +
    #    humo de furia sobre su cabeza (InsultSaid → fxRage).
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida_rico')"), "force caida_rico"
    t0 = time.time()
    grito_sub = False
    q = probe(page)
    while time.time() - t0 < 5:
        q = probe(page)
        if "CABRONE" in bubbles_txt(page).upper():
            grito_sub = True
        if grito_sub and q and q.get("fx", {}).get("rage", 0) >= 1:
            break
        page.wait_for_timeout(90)
    page.screenshot(path=f"{OUT}/t38-4-grito-real.png")
    hits = [r for r in grito_responses if r]
    print(f"GRITO  subtítulo={grito_sub}  fx={q.get('fx')}  respuestas MP3={hits}")
    assert grito_sub, "el grito CABRONEEE… no apareció en el subtítulo"
    assert q["fx"]["rage"] >= 1, "no saltó el humo de furia con el insulto"
    assert hits and any(st == 200 for st, _ in hits), "el MP3 del grito no se pidió"
    body = next((n for st, n in hits if st == 200), 0)
    assert body == GRITO_BYTES, f"el grito servido no es la grabación del jugador: {body} B (esperados {GRITO_BYTES})"

    # 5) el MP3 del grito en INGLÉS también es la grabación del jugador
    r_en = page.request.get(URL + "/audio/rico/en/3b901aa6.mp3")
    assert r_en.status == 200 and len(r_en.body()) == GRITO_BYTES, f"grito EN incorrecto: {r_en.status} {len(r_en.body())}"
    print(f"GRITO EN  200, {len(r_en.body())} B (misma grabación real)")

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T38 OK — 0 errores JS")
    browser.close()
