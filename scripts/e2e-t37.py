#!/usr/bin/env python3
"""E2E Task 37 — CHECKPOINTS cada 10 m + CUERDA COOPERATIVA.
Petición del jugador:
  - Cota de seguro cada 10 m: línea verde discontinua que atraviesa la pared
    (también en el minimapa) y BANDERITAS en los extremos al fijarla.
  - Respawn en la ÚLTIMA cota fijada: "continuar la ascensión sin tener que
    volver al principio" (TeamFell → cota, no campamento/inicio).
  - CUERDA COOPERATIVA: anclarse (seguro corto) y dar impulsos al compañero.
Pipeline: debugForce("subir") ×2 fija cotas 10/20 → caída de EQUIPO forzada
(ambos sueltos: TeamFell legítimo) → respawn en la cota 20 → ancla A → impulso
a B (sube ~1 m) → caída de B atrapada por el SEGURO CORTO del ancla (~1,2 m).
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

def banner_txt(page):
    try:
        return (page.eval_on_selector(".sphud .banner", "el => el.textContent") or "").strip()
    except Exception:
        return ""

def sub_txt(page):
    try:
        return (page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or "").strip()
    except Exception:
        return ""

def tabla_estable(page, seconds=2.0):
    t0 = time.time()
    while time.time() - t0 < seconds:
        q = probe(page)
        if not q or not q.get("plank") or q["plank"]["fell"] or q["plank"]["slide"] > 0.45:
            return False
        page.wait_for_timeout(250)
    return True

def subir_tight(page, intentos=6):
    for i in range(intentos):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), "force subir"
        hi = wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 8, 12, "re-colgado en alto")
        dy = abs(hi["a"]["y"] - hi["b"]["y"])
        if dy < 0.45 and tabla_estable(page):
            page.wait_for_timeout(1200)
            return probe(page)
        print(f"  colgado desparejo (|Δy|={dy:.2f} m) o tabla inestable (intento {i + 1}), re-colgando…")
    return None

def subir_loose(page, intentos=4):
    """Re-cuelga al equipo EN ALTO con pareja TIGHT y tabla estable (patrón
    batallado en e2e-t36: la tabla despareja escora y despacha al ricachón,
    lo que provoca TeamFell ajenos al escenario)."""
    for i in range(intentos):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), "force subir"
        hi = wait_for(page, lambda q: (q["a"]["y"] + q["b"]["y"]) / 2 > 8, 12, "re-colgado en alto")
        dy = abs(hi["a"]["y"] - hi["b"]["y"])
        if dy < 0.45 and tabla_estable(page, 2.0):
            page.wait_for_timeout(1200)
            return probe(page)
        print(f"  colgado desparejo (|Δy|={dy:.2f} m) o tabla inestable (intento {i + 1}), re-colgando…")
    return None

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
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  checkpoints={p['checkpoints']}")
    assert p["checkpoints"]["total"] > 10, "deben existir cotas cada 10 m"
    assert p["checkpoints"]["reached"] == 0, "al inicio ninguna cota está fijada"
    page.screenshot(path=f"{OUT}/t37-0-spawn.png")

    # 1) PRIMERA COTA: subir +12 m → el banner "COTA FIJADA" se caza FRESCO
    #    sondeando banner+sonda a la vez (los reintentos por tabla inestable
    #    pueden cruzar la cota en cualquier intento y el banner caduca en 2,6 s).
    seen_banner = ""
    ok = False
    for intento in range(4):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), "force subir2"
        t0 = time.time()
        while time.time() - t0 < 3.5:
            q = probe(page)
            b = banner_txt(page)
            if "FIJADA" in b.upper():
                seen_banner = b
            if q and q["checkpoints"]["reached"] >= 1 and seen_banner:
                ok = True
                break
            page.wait_for_timeout(120)
        if ok:
            break
    assert ok, f"la primera cota no se fijó con banner (último banner='{banner_txt(page)}')"
    print(f"BANNER='{seen_banner}'")
    page.screenshot(path=f"{OUT}/t37-1-cota.png")
    cp = probe(page)["checkpoints"]
    print(f"COTAS  fijadas {cp['reached']}  última y={cp['lastY']}")

    # 2) RESPAWN EN LA ÚLTIMA COTA: caída de EQUIPO (ambos sueltan — TeamFell
    #    legítimo) → el juego reporta en la sonda DESDE DÓNDE continuó: debe
    #    ser una COTA de seguro (no campamento, no inicio).
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 0)"), "force caida A"
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)"), "force caida B"
    tf = wait_for(page, lambda q: (q["hands"][0]["grips"] == 0 and q["hands"][1]["grips"] == 0), 6, "ambos colgando")
    print(f"TEAMFALL en marcha… A y={tf['a']['y']} B y={tf['b']['y']}")
    resp = wait_for(page, lambda q: q["hands"][0]["grips"] >= 2 and q["hands"][1]["grips"] >= 2 and q.get("respawn") and q["respawn"]["kind"] != "start", 14, "respawn tras TeamFell")
    y_resp = (resp["a"]["y"] + resp["b"]["y"]) / 2
    org = resp["respawn"]
    print(f"RESPAWN  medio y={y_resp:.2f}  origen={org}")
    assert org["kind"] == "checkpoint", f"el respawn debió ser en COTA, no en {org}"
    assert abs(y_resp - org["y"]) < 2.6, f"no reapareció en la cota {org['y']}: medio y={y_resp}"
    assert org["y"] >= 10, "¡volvió al principio! el checkpoint no funcionó"
    page.screenshot(path=f"{OUT}/t37-2-respawn-cota.png")

    # 3) CUERDA COOPERATIVA: A se ANCLA (seguro corto activo)
    for intento in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('ancla', 0)"), "force ancla"
        q = wait_for(page, lambda q: q["coop"][0]["anchored"], 3, "ancla A", soft=True)
        if q:
            break
        page.wait_for_timeout(800)  # re-intento: puede haber perdido agarres
    q = probe(page)
    assert q["coop"][0]["anchored"], "A no quedó anclado"
    print(f"ANCLA A activa  grips={q['hands'][0]['grips']}")

    # 4) IMPULSO: A (ancla) da un empujón a B — B sube ~1 m de verdad.
    #    UN solo bucle desde el disparo: sondea pico de B y ventana a 80 ms
    #    (arrancar tras confirmar la ventana llega tarde: la subida dura 0,45 s).
    #    Re-intentos: si B estaba haulando/colgado, receiveImpulse se rechaza.
    b_before = q["b"]["y"]
    got = False
    peak = b_before
    for intento in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('impulso', 0)"), "force impulso"
        t0 = time.time()
        while time.time() - t0 < 2.5:
            q2 = probe(page)
            if q2:
                peak = max(peak, q2["b"]["y"])
                got = got or q2["coop"][1]["impulse"]
            if got and time.time() - t0 > 1.0:
                break
            page.wait_for_timeout(80)
        if got:
            break
        page.wait_for_timeout(2600)  # cooldown del ancla / haula en curso
    assert got, "B no recibió el impulso (ventana nunca activa)"
    b_up = peak - b_before
    print(f"IMPULSO  pico de B = +{b_up:.2f} m (de {b_before:.2f})")
    assert 0.45 < b_up < 2.2, f"el impulso no elevó a B lo esperado: pico {b_up}"
    page.screenshot(path=f"{OUT}/t37-3-impulso.png")
    # B re-agarra y vuelve a climbing (el re-agarre del empujón)
    wait_for(page, lambda q: q["rope"][1]["s"] == "climbing" and q["hands"][1]["grips"] >= 1, 8, "B re-agarra tras impulso")

    # 5) SEGURO CORTO: B cae y el ANCLA de A lo detiene en ~1,2 m (< holgura 2,9)
    #    Subtítulo y estado se sondean JUNTOS: el susto del ricachón dispara un
    #    insulto que sustituye el subtítulo en ~1 s (barra única).
    caught = None
    ok_sub = False
    for intento in range(3):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida', 1)"), "force caida B"
        t0 = time.time()
        while time.time() - t0 < 6:
            q = probe(page)
            s = sub_txt(page).upper()
            if "SEGURO" in s:
                ok_sub = True
            if q and q["rope"][1]["s"] == "caught":
                q_check = probe(page)
                if q_check and q_check["coop"][0]["anchored"]:
                    caught = q
                    break
            if caught and ok_sub:
                break
            page.wait_for_timeout(100)
        if caught and ok_sub:
            break
        page.wait_for_timeout(1500)  # B haula y re-agarra: re-intento
    assert caught, "no se pudo atrapar la caída de B con el ancla activa"
    drop_b = caught["rope"][1]["drop"]
    print(f"SEGURO CORTO  drop de B = {drop_b} m (holgura normal 2,9 m)")
    assert 0.4 <= drop_b <= 2.0, f"el seguro corto no detuvo en ~1,2 m: {drop_b}"
    page.screenshot(path=f"{OUT}/t37-4-belay-catch.png")
    print(f"SUBTÍTULO capturado: '{sub_txt(page)}'")
    assert ok_sub, "el aviso del seguro corto no apareció"

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T37 OK — 0 errores JS")
    browser.close()
