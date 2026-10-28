#!/usr/bin/env python3
"""E2E Task 36 — CAÍDAS DE LOS SHERPAS: la cuerda de porteo hace de seguro.
Petición del jugador (roadmap aprobado, punto 2):
  - Soltar/soltarse → el sherpa CAE de verdad (caída libre honesta).
  - La CUERDA lo ATRAPA (chicote): sonido + subtítulo + sacudida + propina.
  - Pierde altura y tiempo, pero NO hay respawn: recupera mano a mano hasta
    su punto de despegue y puede re-agarrarse (la partida no se reinicia).
  - El compañero NO arrastra al equipo: sin "CAÍDA DE EQUIPO" por una caída
    individual (teamFall excluye al sherpa sostenido por su cuerda).
Pipeline: debugForce("subir") re-cuelga al equipo en alto (pareja tight) →
debugForce("caida") suelta las 4 extremidades de P0 → el estado de cuerda hace
el resto. Con reintento: a gran altura el director (pájaros/rachas) puede
soltar al compañero y ese TeamFell es juego legítimo, no fallo del seguro.
"""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
OUT = "/home/z/my-project/download"

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

def tabla_estable(page, seconds=2.5):
    """True si durante `seconds` la tabla no cae y el deslizamiento se mantiene bajo."""
    t0 = time.time()
    while time.time() - t0 < seconds:
        q = probe(page)
        if not q or not q.get("plank") or q["plank"]["fell"] or q["plank"]["slide"] > 0.45:
            return False
        page.wait_for_timeout(250)
    return True

def subir_tight(page, intentos=6):
    """Re-cuelga al equipo EN ALTO con pareja a nivel y tabla asentada."""
    for i in range(intentos):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')"), "force subir"
        hi = wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 8, 12, "re-colgado en alto")
        dy = abs(hi["a"]["y"] - hi["b"]["y"])
        if dy < 0.45 and tabla_estable(page):
            page.wait_for_timeout(1200)  # asentar el colgado (viajes de extremidades)
            return probe(page)
        print(f"  colgado desparejo (|Δy|={dy:.2f} m) o tabla inestable (intento {i + 1}), re-colgando…")
    return None

def escenario_caida(page):
    """subir tight → force caida → espera chicote. Devuelve la sonda del chicote
    o None si el intento se contaminó (p. ej. el director soltó al compañero)."""
    base = subir_tight(page)
    if not base:
        return None
    y0_a, b_before = base["a"]["y"], base["b"]["y"]
    print(f"BASE  A y={y0_a}  B y={b_before}")
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 0)"), "force caida"
    falling = wait_for(page, lambda q: q["rope"][0]["s"] == "falling", 4, "estado falling", soft=True)
    if falling:
        page.screenshot(path=f"{OUT}/t36-1-cayendo.png")
        print(f"CAYENDO  drop={falling['rope'][0]['drop']} m")
    caught = wait_for(page, lambda q: q["rope"][0]["s"] == "caught", 6, "estado caught (chicote)", soft=True)
    if not caught:
        return None
    # el intento solo vale si el compañero está EXENTO (el juego pudo soltarlo
    # por pájaro/racha: eso es TeamFell legítimo, no fallo del seguro)
    if caught["rope"][1]["s"] != "climbing" or caught["hands"][1]["grips"] < 2:
        print(f"  intento contaminado: B rope={caught['rope'][1]['s']} grips={caught['hands'][1]['grips']}")
        return None
    return {"caught": caught, "y0_a": y0_a, "b_before": b_before}

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  rope={[r['s'] for r in p['rope']]}")
    assert all(r["s"] == "climbing" for r in p["rope"]), "el seguro debe nacer en reserva (climbing)"
    page.screenshot(path=f"{OUT}/t36-0-spawn.png")

    # LA CAÍDA (con reintento por interferencia del director)
    run = None
    for intento in range(2):
        run = escenario_caida(page)
        if run:
            break
        print(f"  repitiendo escenario de caída (intento {intento + 1})…")
    assert run, "no se pudo completar el escenario de caída limpio"
    caught, y0_a, b_before = run["caught"], run["y0_a"], run["b_before"]
    drop_at_catch = caught["rope"][0]["drop"]
    print(f"CHICOTE  estado={caught['rope'][0]['s']} drop={drop_at_catch} m  A y={caught['a']['y']}")
    page.screenshot(path=f"{OUT}/t36-2-colgado-cuerda.png")
    assert 1.2 <= drop_at_catch <= 4.8, f"caída atrapada fuera de rango: {drop_at_catch}"

    # PERDIDA REAL DE ALTURA (no respawn): A acabó por DEBAJO de su despegue
    assert caught["a"]["y"] < y0_a - 1.2, f"A no perdió altura real: {y0_a} → {caught['a']['y']}"
    # y la tabla SIGUE ahí (el equipo la aguanta: ricachón agarrado)
    assert not caught["plank"]["fell"], "la tabla no debe caer por una caída individual"

    # SUBTÍTULO "¡LA CUERDA AGARRA A P1!" en DOM
    sub_txt = ""
    t0 = time.time()
    while time.time() - t0 < 4:
        sub_txt = page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or ""
        if "CUERDA" in sub_txt.upper() or "mano a mano" in sub_txt.lower():
            break
        page.wait_for_timeout(150)
    print(f"SUBTÍTULO='{sub_txt}'")
    assert "CUERDA" in sub_txt.upper() or "mano a mano" in sub_txt.lower(), "el aviso de captura no apareció"

    # SIN RESPAWN: nada de "CAÍDA DE EQUIPO" — B sigue donde estaba
    sub2 = page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or ""
    assert "EQUIPO" not in sub2.upper(), "¡una caída individual NO debe causar caída de equipo!"
    assert abs(caught["b"]["y"] - b_before) < 2.0, "B se movió demasiado: ¿caída de equipo?"

    # RECUPERACIÓN MANO A MANO: hauling → drop baja hasta ≈ 0,35 m del despegue
    hauling = wait_for(page, lambda q: q["rope"][0]["s"] == "hauling", 8, "estado hauling")
    print(f"RECUPERANDO  drop={hauling['rope'][0]['drop']} m")
    page.screenshot(path=f"{OUT}/t36-3-recuperando.png")
    hauled = wait_for(page, lambda q: q["rope"][0]["drop"] <= 1.0, 10, "recobrado casi completo")
    print(f"RECUPERADO  drop={hauled['rope'][0]['drop']} m  A y={hauled['a']['y']} (despegue {y0_a})")
    page.screenshot(path=f"{OUT}/t36-4-recuperado.png")

    # RE-AGARRE: la cuerda vuelve a holgura (climbing) — la partida sigue ahí
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir')"), "force subir (re-agarrado)"
    back = wait_for(page, lambda q: all(r["s"] == "climbing" for r in q["rope"]), 12, "cuerda en reserva tras re-agarrarse")
    print(f"RE-AGARRADO  rope={[r['s'] for r in back['rope']]}  A y={back['a']['y']}")

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T36 OK — 0 errores JS")
    browser.close()
