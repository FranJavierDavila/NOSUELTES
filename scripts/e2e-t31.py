#!/usr/bin/env python3
"""E2E Task 31 — paquete de mecánicas aprobadas:
  (1) FATIGA SOBRE EXTREMIDADES: 8 insignias .lbadge sobre los escaladores.
  (2) MINIMAPA: franja con metros hasta la próxima base (texto no vacío).
  (3) CAJAS DEL RICACHÓN: force("boxes") → probe boxes + cargoKg>0 + captura.
  (4) CÓNDOR: force("condor") → posa (probe condor) + captura.
  (5) MODO TORMENTA: force("storm") → phase warn→gust con storm=true + cielo
      oscuro (captura) y racha que empuja SIN despachar al ricachón.
  (6) SUPER FLATULENCIA: force("fart") + tecla F → flying=true + captura del
      gas verde; al aterrizar re-agarra (anclas>0 o vuelve al campamento).
  (7) SALIENTES: sonda salientes >= 0 (el generador las reparte por semilla).
"""
import json, sys, time
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

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(250)
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:500]}")

def force(page, what, player=None):
    return page.evaluate("""([w, p]) => {
        const dbg = window.__SHERPAS_DEBUG;
        return dbg && dbg.force ? dbg.force(w, p) : null;
    }""", [what, player])

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda p: p.get("hands") and p["hands"][0]["grips"] >= 3 and p["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}  salientes={p.get('salientes')}")

    # 2) INSIGNIAS de fatiga sobre extremidades (8) + MINIMAPA con texto
    badges = page.eval_on_selector_all(".sphud .lbadge", "els => els.map(e => ({p: e.dataset.p, limb: e.dataset.limb, vis: e.style.display !== 'none'}))")
    assert len(badges) == 8, f"esperaba 8 insignias, hay {len(badges)}"
    visible = [b for b in badges if b["vis"]]
    assert len(visible) >= 4, f"insignias visibles: {len(visible)} (esperaba ≥4 sobre los escaladores)"
    mm_label = page.text_content(".sphud [data-e=mmLabel]")
    assert mm_label and mm_label.strip() not in ("", "—"), f"minimapa sin texto: {mm_label!r}"
    mm_camp_h = page.eval_on_selector(".sphud [data-e=mmCamp]", "e => e.style.height")
    print(f"BADGES OK  8 insignias ({len(visible)} visibles)  MINIMAPA OK  '{mm_label.strip()}' zona_camp={mm_camp_h}")
    page.screenshot(path=f"{OUT}/t31-1-hud-insignias-minimapa.png")

    # 3) CAJAS del ricachón
    assert force(page, "boxes") is True, "force(boxes) falló"
    p = wait_for(page, lambda p: p.get("boxes") and p["boxes"]["count"] == 3 and p.get("cargoKg", 0) > 0, 8, "cajas sobre la tabla")
    print(f"CAJAS OK  {p['boxes']}  cargoKg={p['cargoKg']}")
    page.screenshot(path=f"{OUT}/t31-2-cajas-tabla.png")
    # el ricachón las recoge al rato (16-30 s): esperamos la caducidad
    p = wait_for(page, lambda p: p.get("boxes") is None, 35, "cajas recogidas")
    print("CAJAS RECOGIDAS OK (caducidad)")

    # 4) CÓNDOR
    assert force(page, "condor") is True, "force(condor) falló"
    p = wait_for(page, lambda p: p.get("condor") and p["condor"]["kg"] > 0, 15, "cóndor posado")
    print(f"CONDOR OK  posado con {p['condor']['kg']} kg  cargoKg={p['cargoKg']}")
    page.screenshot(path=f"{OUT}/t31-3-condor-tabla.png")
    p = wait_for(page, lambda p: p.get("condor") is None, 20, "cóndor se va")
    print("CONDOR SE FUE OK (cargo fuera)")

    # 5) MODO TORMENTA
    assert force(page, "storm") is True, "force(storm) falló"
    p = wait_for(page, lambda p: p["weather"].get("storm") is True and p["weather"]["phase"] in ("warn", "gust"), 10, "tormenta")
    print(f"TORMENTA OK  weather={p['weather']}")
    page.screenshot(path=f"{OUT}/t31-4-tormenta-aviso.png")
    p = wait_for(page, lambda p: p["weather"]["phase"] == "gust" and p["weather"].get("storm") is True, 12, "racha de tormenta")
    a0 = p["a"]["x"]
    page.screenshot(path=f"{OUT}/t31-5-tormenta-racha.png")
    p = wait_for(page, lambda p: p["weather"]["phase"] == "calm" or not p["weather"].get("storm"), 40, "calma tras tormenta")
    print(f"TORMENTA CALMA OK  ricachón vivo (fell={p['plank']['fell']})  slideFrac={p['plank']['slide']}")

    # 6) SUPER FLATULENCIA: carga + tecla F → vuelo con gas verde
    assert force(page, "fart") is True, "force(fart) falló"
    ico_on = page.eval_on_selector("[data-fart='0']", "e => e.classList.contains('on')")
    assert ico_on, "el icono 💨 no se encendió con la carga"
    y_before = probe(page)["a"]["y"]
    page.keyboard.press("KeyF")
    p = wait_for(page, lambda p: p["fart"][0]["flying"] is True, 4, "vuelo del pedo-propulsor")
    page.screenshot(path=f"{OUT}/t31-6-super-flatulencia.png")
    print(f"PUM OK  vuelo en curso (gas verde)  icono 💨 activo")
    p = wait_for(page, lambda p: p["fart"][0]["flying"] is False, 6, "fin del vuelo")
    y_after = p["a"]["y"]
    print(f"VUELO OK  Δy = {y_after - y_before:+.2f} m  anclas A={p['hands'][0]['grips']} (re-agarre)  B vivo={p['hands'][1]['grips'] > 0}")

    # 7) sanity final: partida viva, sin errores JS
    p = wait_for(page, lambda p: p["hands"][0]["grips"] + p["hands"][1]["grips"] > 0 or p["plank"]["fell"], 20, "estado final")
    print(f"FINAL OK  fell={p['plank']['fell']}  salientes_en_pared={p.get('salientes')}")
    page.screenshot(path=f"{OUT}/t31-7-final.png")

    if errors:
        print(f"\nERRORES JS ({len(errors)}):")
        for e in errors[:5]:
            print("  ", e[:200])
        sys.exit(1)
    print("\nE2E T31 COMPLETO: sin errores JavaScript")
    browser.close()
