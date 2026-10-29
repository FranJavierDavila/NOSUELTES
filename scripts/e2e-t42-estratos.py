#!/usr/bin/env python3
"""E2E Task 42 — ESTRATOS TONALES en la pared de piedra.
Petición del jugador: "Se le podría dar a la pared diferentes tonos de piedra
con un efecto de estratos de forma que tengamos un patrón de diferentes tonos
y mejoremos la apariencia de la piedra."

Comprobaciones:
  1. DATOS: wall_gen.relief lleva strataTones (≥2 tonos), strataToneStrength y
     strataSeamDark → la sonda relief del juego los refleja (paleta viva).
  2. BANDAS REALES EN VÉRTICES (rockBands): color medio por cubeta de media
     capa leído de la malla Babylon → switches de tono entre bandas contiguas.
  3. SUBIDA ×2: el streaming construye chunks NUEVOS y el bandeo persiste.
  4. VOZ CASTELLANA (regresión T41): banco ES servido sano y GRITO REAL
     intacto (62829 B).
Pipeline: menú → GO → spawn → bandas → subir → bandas → voz → 0 errores JS.
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

def wait_for(page, cond, timeout_s, label):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        p = probe(page)
        last = p
        if p and cond(p):
            return p
        page.wait_for_timeout(150)
    raise SystemExit(f"TIMEOUT esperando {label}; última sonda: {json.dumps(last)[:600]}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) DATOS REALES del pack: la paleta vive en wall_gen.relief
    wdata = page.evaluate("""fetch('/content/sherpas/wall_gen.json').then(r => r.json())""")
    rel = wdata["relief"]
    tones = rel.get("strataTones", [])
    strength = rel.get("strataToneStrength", 0)
    seam = rel.get("strataSeamDark", 0)
    print(f"DATOS strataTones={tones}  strength={strength}  seamDark={seam}")
    assert len(tones) >= 2, "paleta de estratos ausente en wall_gen.relief"
    assert 0.4 <= strength <= 1.0, f"fuerza del bandeo fuera de rango: {strength}"
    assert 0 < seam <= 0.6, f"costura fuera de rango: {seam}"

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.screenshot(path=f"{OUT}/t42-0-menu.png")
    print("CAPTURA t42-0-menu.png")
    page.click("button[data-a=go]")

    # 2) SPAWN: roca construida y paleta VIVA en la sonda
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 25, "spawn")
    r = wait_for(page, lambda q: q.get("relief") and q["relief"]["chunks"] > 0 and q["relief"]["tris"] > 0, 15, "roca en spawn")
    ri = r["relief"]
    print(f"ROCA algoritmo={ri['algorithm']} chunks={ri['chunks']} tris={ri['tris']} | TONOS={ri.get('strataTones')} strength={ri.get('strataToneStrength')} seam={ri.get('strataSeamDark')}")
    assert ri["algorithm"] == "estratificada"
    assert ri.get("strataTones") == len(tones), f"la sonda no refleja la paleta: {ri.get('strataTones')}"
    assert abs((ri.get("strataToneStrength") or 0) - strength) < 1e-6
    assert abs((ri.get("strataSeamDark") or 0) - seam) < 1e-6
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/t42-1-spawn-estratos.png")
    print("CAPTURA t42-1-spawn-estratos.png")

    # 3) BANDAS EN LOS VÉRTICES (a prueba de cámara/luz): cubetas de media capa
    bands = page.evaluate("window.__SHERPAS_DEBUG.rockBands()")
    print(f"BANDAS vértices: {bands}")
    assert bands, "rockBands devolvió null (¿roca inactiva?)"
    assert bands["bands"] >= 6, f"pocas cubetas analizadas: {bands['bands']}"
    assert bands["switches"] >= 5, f"sin patrón de bandas: solo {bands['switches']} cambios de tono"
    assert bands["maxDelta"] >= 0.08, f"cambio de tono entre bandas demasiado débil: {bands['maxDelta']:.3f}"
    assert bands["meanDelta"] >= 0.02, f"variación media entre cubetas demasiado baja: {bands['meanDelta']:.4f}"

    # 4) SUBIDA ×2: streaming de chunks nuevos, el bandeo PERSISTE
    band0 = ri["viewBand"]; builds0 = ri["builds"]
    for i in range(2):
        assert page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('subir2')"), f"force subir2 #{i}"
        page.wait_for_timeout(900)
    p2 = wait_for(page, lambda q: q.get("relief") and q["relief"]["viewBand"] > band0 and q["relief"]["builds"] > builds0, 20, "streaming al subir")
    ri2 = p2["relief"]
    print(f"SUBIDA banda {band0}→{ri2['viewBand']} builds {builds0}→{ri2['builds']} chunks={ri2['chunks']}")
    assert ri2["chunks"] <= 9, f"LRU excedido tras subir: {ri2['chunks']}"
    bands2 = page.evaluate("window.__SHERPAS_DEBUG.rockBands()")
    print(f"BANDAS tras subir: {bands2}")
    assert bands2 and bands2["switches"] >= 5, "el bandeo se perdió en los chunks nuevos"
    page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/t42-2-subida-estratos.png")
    print("CAPTURA t42-2-subida-estratos.png")

    # 5) VOZ CASTELLANA (regresión T41): banco ES sano + GRITO REAL intacto
    voice = page.evaluate("""async () => {
      const bank = await fetch('/content/sherpas/insults_es.json').then(r => r.json());
      const slug = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };
      const texts = Object.values(bank).flat();
      const out = { served: 0, missing: 0, bad: 0 };
      for (const t of texts) {
        const res = await fetch('/audio/rico/es/' + slug(t) + '.mp3');
        if (!res.ok) { out.missing++; continue; }
        const size = Number(res.headers.get('content-length') || 0);
        if (size > 4000) out.served++; else out.bad++;
      }
      const grito = await fetch('/audio/rico/es/cd0e9f33.mp3');
      out.grito = { ok: grito.ok, size: Number(grito.headers.get('content-length') || 0) };
      return out;
    }""")
    print(f"VOZ ES: servidos={voice['served']} ausentes={voice['missing']} corruptos={voice['bad']}")
    assert voice["served"] >= 25, f"cobertura del banco ES cayó: {voice['served']}"
    assert voice["bad"] == 0, "MP3 corruptos en el banco ES"
    assert voice["grito"]["ok"] and voice["grito"]["size"] == 62829, \
        f"¡EL GRITO REAL HA CAMBIADO!: {voice['grito']} (esperado 62829 B)"
    print("GRITO REAL intacto (62829 B)")

    # 6) CERO errores JS
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 errores JS")
    browser.close()
    print("E2E T42 COMPLETO EN VERDE")
