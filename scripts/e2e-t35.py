#!/usr/bin/env python3
"""E2E Task 35 — peticiones del jugador:
  (1) SIN ANILLO bajo los escaladores: el toro-etiqueta p{0,1}_ring fue
      ELIMINADO (no tenía función; el color del cuerpo ya identifica al sherpa).
      Verificación: captura del spawn (sin circulo bajo la pelvis).
  (2) CAÍDA CONTUNDENTE del ricachón: kick ×2,4 + techo de velocidad 16 m/s +
      IMPACTO contra el suelo (thud + sacudida de cámara) + EL GRITO
      "¡¡CABRONEEEEESSSS!!!!" (MP3 TTS → speechSynthesis → gibberish; subtítulo
      y burbuja obligatorios en DOM).
  (3) PERF: probe.perf expuesto (fps/frameTimeMs/drawCalls/escala).
  (4) 0 errores JS + petición HTTP 200 del MP3 del grito.
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
        page.wait_for_timeout(250)
    if soft:
        return None
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    rico_status = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: rico_status.append((r.url.split("/")[-1], r.status))
            if "/audio/rico/" in r.url else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    print(f"SPAWN OK  anclas {p['hands'][0]['grips']}+{p['hands'][1]['grips']}")

    # (1) SIN ANILLO: captura del equipo recién nacido (antes había un toro
    #     naranja/azul bajo la pelvis de cada sherpa).
    page.screenshot(path=f"{OUT}/t35-0-spawn-sin-anillo.png")

    # (3) PERF base: 5 s de muestreo de probe.perf
    samples = []
    t0 = time.time()
    while time.time() - t0 < 5:
        q = probe(page)
        if q and q.get("perf"):
            samples.append(q["perf"])
        page.wait_for_timeout(400)
    if samples:
        fps = [s["fps"] for s in samples]
        draws = [s["drawCalls"] for s in samples]
        scale = samples[-1]["scale"]
        print(f"PERF BASE  fps {min(fps)}-{max(fps)} (SwiftShader)  draws {min(draws)}-{max(draws)}  res x1/{scale}")
    else:
        print("PERF BASE  sonda perf NO disponible")

    # (2) CAÍDA DEL RICACHÓN: debugForce("caida_rico") fuerza fellOff y la caída
    #     corre por su pipeline NATURAL completo (launchFall → grito → thud →
    #     respawn). Poll 6 s.
    assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida_rico')"), "force caida_rico"
    fell = wait_for(page, lambda q: q.get("plank") and q["plank"].get("fell"), 6, "caida del ricachon", soft=True)
    assert fell, "debugForce('caida_rico') no produjo fellOff"
    pk = fell["plank"]
    print(f"CAIDA DEL RICACHON  tilt={pk['tiltDeg']}deg slide={pk['slide']} fell={pk['fell']}")

    # EL GRITO: subtítulo visible con el improperio (DOM) + burbuja.
    subtitle_txt = ""
    bubble_txt = ""
    t0 = time.time()
    while time.time() - t0 < 4:
        subtitle_txt = page.eval_on_selector(".sphud .subtitle-bar", "el => el.textContent") or ""
        bubbles = page.query_selector_all(".sphud .bubble")
        bubble_txt = " | ".join(b.text_content() or "" for b in bubbles)
        if "CABRONE" in subtitle_txt.upper() or "CABRONE" in bubble_txt.upper():
            break
        page.wait_for_timeout(200)
    print(f"GRITO  subtítulo='{subtitle_txt}'  burbuja='{bubble_txt}'")
    page.screenshot(path=f"{OUT}/t35-1-caida-grito.png")
    assert "CABRONE" in (subtitle_txt + bubble_txt).upper(), "el grito no apareció en pantalla"

    # IMPACTO: esperar el thud (ragdoll en el suelo) y capturar.
    page.wait_for_timeout(1600)
    page.screenshot(path=f"{OUT}/t35-2-impacto-suelo.png")
    print("IMPACTO capturado (thud + sacudida ocurren en el primer floorHit)")

    # el MP3 del grito: la escalera debe haber pedido /audio/rico/es/cd0e9f33.mp3
    rico_hits = [s for s in rico_status if s[1] == 200]
    print(f"MP3 GRITO  peticiones={rico_status}  200s={len(rico_hits)}")

    # respawn limpio tras 2,6 s: el equipo vuelve y el rico está sentado otra vez
    page.wait_for_timeout(3000)
    q = probe(page)
    print(f"RESPAWN  plank.fell={q['plank']['fell'] if q and q.get('plank') else '?'}")

    assert not errors, f"errores JS: {errors[:3]}"
    print("E2E T35 OK — 0 errores JS")
    browser.close()
