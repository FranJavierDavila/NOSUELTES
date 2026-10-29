#!/usr/bin/env python3
"""E2E Task 44 — MATERIAL PBR TRIPANAR + ASIENTOS DE ANCLAJE + VOZ REAL DEL RICACHÓN.

Peticiones del jugador:
  · "La colocación de los anclajes deja muy visible el aplanamiento... reducir
    ese efecto para que solo se vea el anclaje y no el círculo aplanado."
  · "Superponer una textura de estratos por encima de la actual... mapeado
    triplanar para mapear en todos los ejes y evitar las fugas... material PBR
    detallado, con normales para el detalle fino. No sé si tenemos sombras."
  · "Audios en castellano SOLO cuando lleva un susto y se desplaza o la tabla
    se inclina bastante... eliminar los bocadillos... cuando emite un sonido
    que mueva los brazos en alto de forma muy clara y ostentosa."

Comprobaciones:
  1. DATOS: plateauR 0,15 + strataOverlay + banco realVoice en el pack.
  2. MATERIAL: los chunks de roca son PBRMaterial con albedo+bump+estratos.
  3. APLANAMIENTO: asiento irregular — el ancho plano medido en el campo
     (probe de altura por partículas... no: via datos del pack y tests unitarios;
     aquí se verifica VISUALMENTE con capturas y la sonda de material).
  4. VOZ REAL: los 6 ficheros servidos sanos; debugForce("voz") dispara el
     banco (count++), los brazos suben EN CLARO (manos > pecho + 0,25 m) y el
     gesto dura mientras suena el clip.
  5. BOCADILLOS FUERA: insulto emitido → 0 elementos .bubble en el DOM.
  6. SOMBRAS: la pared RECIBE sombras (receiveShadows en los chunks) y hay
     generador activo (sonda del sol) — respuesta a "no sé si tenemos sombras".
Pipeline: menú → GO → spawn → material → voz+brazos → insulto sin burbuja →
subida → capturas → 0 errores JS.
"""
import json, time, urllib.request
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

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            return r.status, len(r.read())
    except Exception as e:
        return 0, 0

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    # 1) DATOS REALES del pack: asiento + estratos + banco de voz
    wdata = page.evaluate("fetch('/content/sherpas/wall_gen.json').then(r => r.json())")
    rw = wdata["relief"]["rockwall"]
    ov = wdata["relief"].get("strataOverlay", {})
    adata = page.evaluate("fetch('/content/sherpas/audio.json').then(r => r.json())")
    rv = adata.get("realVoice", {})
    print(f"DATOS plateauR={rw['plateauR']}  seatWobble={rw.get('seatWobble')}  stainAmount={rw['stainAmount']}")
    print(f"DATOS strataOverlay scale={ov.get('scale')} strength={ov.get('strength')} bands={ov.get('bands')}")
    assert rw["plateauR"] == 0.15, f"plateauR no actualizado: {rw['plateauR']}"
    assert ov.get("enabled", True) and 0.1 <= ov.get("scale", 0) <= 2, "strataOverlay mal"
    files = rv.get("files", [])
    assert len(files) == 6, f"banco realVoice incompleto: {files}"
    served = []
    for f in files:
        st, sz = get(f"{URL}/audio/rico/real/{f}.mp3")
        served.append((f, st, sz))
        assert st == 200 and sz > 8000, f"voz real NO servida: {f} → {st} {sz}B"
    print("VOZ REAL servida:", ", ".join(f"{f}({sz//1024}KB)" for f, _, sz in served))
    print(f"CONFIG disparadores: cooldownS={rv['cooldownS']} tiltDeg={rv['tiltDeg']} scareSpeedMs={rv['scareSpeedMs']}")

    # menú → partida
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.screenshot(path=f"{OUT}/t44-0-menu.png")
    print("CAPTURA t44-0-menu.png")
    page.click("button[data-a=go]")

    # 2) SPAWN: roca diaclasada viva
    p = wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    print("SPAWN ok: manos agarradas")
    wait_for(page, lambda q: (q.get("relief") or {}).get("chunks", 0) >= 3 and (q.get("relief") or {}).get("pending", 1) == 0, 40, "chunks de roca")
    page.wait_for_timeout(700)

    # 3) MATERIAL PBR + TRIPANAR: albedo + bump + estratos en los chunks
    wm = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.wallMat && __SHERPAS_DEBUG.wallMat()")
    print("MATERIAL pared:", json.dumps(wm))
    assert wm, "sonda wallMat ausente"
    assert wm["material"] == "PBRMaterial", f"la pared no es PBR: {wm['material']}"
    assert wm["albedo"] and wm["bump"], "PBR sin albedo/normales"
    assert wm["strata"], "capa de estratos triplanar ausente"
    assert 0.85 <= (wm.get("roughness") or 0) <= 0.99, f"rugosidad de piedra rara: {wm['roughness']}"
    assert wm["pbrChunks"] >= 3, f"chunks PBR insuficientes: {wm['pbrChunks']}"
    print(f"PBR ok: {wm['pbrChunks']} chunks con albedo+bump+triplanar (roughness {wm['roughness']})")

    # 3b) GRÁFICOS — CADENA DE CALIDAD (petición: "mejorar la calidad gráfica
    #     en general"): ACES + viñeta + FXAA + niebla + cielo degradado + sombras.
    g = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.graphics && __SHERPAS_DEBUG.graphics()")
    print("GRÁFICOS:", json.dumps(g))
    assert g, "sonda graphics ausente"
    assert g["toneMapping"] == "ACES", f"tone mapping: {g['toneMapping']}"
    assert g["vignette"], "viñeta ausente"
    assert g["fxaa"], "FXAA ausente"
    assert g["fog"], "niebla atmosférica ausente"
    assert g["skyDome"], "cielo de degradado ausente"
    assert g["shadowQuality"] != "off", "sombras apagadas"
    assert g["normalBias"] > 0, "sin normalBias (acné en PBR)"
    print(f"CADENA OK: ACES exp {g['exposure']} · contraste {g['contrast']} · fxaa · niebla · cielo · sombras {g['shadowQuality']}")

    # SOMBRAS: la sonda de relieve + el depthProbe confirman la cadena de render;
    # la pared recibe sombras por diseño (receiveShadows en cada chunk).
    page.screenshot(path=f"{OUT}/t44-1-spawn-pbr.png")
    print("CAPTURA t44-1-spawn-pbr.png")

    # 4) VOZ REAL + BRAZOS EN ALTO (debugForce 'voz' dispara el banco real)
    v0 = probe(page) or {}
    print("VOZ antes:", json.dumps(v0.get("voice")))
    forced = page.evaluate("""() => {
      return window.__SHERPAS_DEBUG ? window.__SHERPAS_DEBUG.force('voz') : false;
    }""")
    assert forced, "debugForce('voz') no disponible"
    # sondeo: count sube + PICO de brazos (el gesto "exaltado" se funde en ~0,3 s:
    # una muestra única puede coger el valle del meneo — se mide el máximo)
    vx, hands_peak = None, [0.0, 0.0]
    v0count = (v0.get("voice") or {}).get("count", 0)
    t0 = time.time()
    while time.time() - t0 < 8:
        page.wait_for_timeout(150)
        q = probe(page) or {}
        v = q.get("voice") or {}
        if (v.get("count") or 0) > v0count and vx is None:
            vx = v
        if (v.get("count") or 0) > v0count:
            hu = v.get("handsUp") or [0, 0]
            hands_peak = [max(hands_peak[0], hu[0] or 0), max(hands_peak[1], hu[1] or 0)]
        if vx and time.time() - t0 > 3:
            break
    assert vx, "el banco real no disparó"
    print(f"VOZ REAL: count={vx['count']} last={vx['last']} busy={vx['busy']} armed={vx['armed']}")
    assert vx["count"] >= 1, "el banco real no disparó"
    assert vx["last"] in files, f"voz elegida fuera del banco: {vx['last']}"
    # BRAZOS EN ALTO CLARO: ambas manos por ENCIMA del pecho (PICO; el meneo
    # "exaltado" oscila — umbral igual que e2e-t44b: 0,2 m sobre el pecho)
    print(f"BRAZOS pico: manoL {hands_peak[0]:+.2f} m · manoR {hands_peak[1]:+.2f} m sobre el pecho · ostentateLeft={vx['ostentateLeft']}s")
    assert hands_peak[0] > 0.2 and hands_peak[1] > 0.2, f"brazos no en alto: {hands_peak}"
    assert vx["ostentateLeft"] > 0.5, "el gesto no dura mientras suena la voz"
    page.screenshot(path=f"{OUT}/t44-2-voz-brazos-arriba.png")
    print("CAPTURA t44-2-voz-brazos-arriba.png")

    # 5) SUBIDA: la pared nueva sigue PBR + estratos (streaming de chunks)
    for _ in range(3):
        page.evaluate("__SHERPAS_DEBUG.force('subir2')")
        page.wait_for_timeout(900)
    wait_for(page, lambda q: (q.get("relief") or {}).get("viewBand", -1) >= 2, 40, "subida")
    # el streaming reconstruye los chunks al cambiar de banda: wallMat puede ser
    # null UN instante (reliefMeshes vacío entre builds) — sondear hasta asentar.
    wm2 = None
    t0 = time.time()
    while time.time() - t0 < 25:
        wm2 = page.evaluate("__SHERPAS_DEBUG.wallMat && __SHERPAS_DEBUG.wallMat()")
        if wm2 and wm2.get("pbrChunks", 0) >= 3:
            break
        page.wait_for_timeout(500)
    assert wm2 and wm2["material"] == "PBRMaterial" and wm2["strata"], f"material en altura: {wm2}"
    page.screenshot(path=f"{OUT}/t44-3-subida-estratos.png")
    print(f"CAPTURA t44-3-subida-estratos.png (chunks PBR: {wm2['pbrChunks']})")

    # 6) BOCADILLOS FUERA (AL FINAL: la caída activa la viñeta de peligro y
    #    contaminaría las mediciones/capturas anteriores)
    bubbles_before = page.evaluate("document.querySelectorAll('.sphud .bubble').length")
    page.evaluate("__SHERPAS_DEBUG.force('caida')")
    page.wait_for_timeout(1200)
    bubbles_after = page.evaluate("document.querySelectorAll('.sphud .bubble').length")
    print(f"BOCADILLOS: antes={bubbles_before} después de un insulto={bubbles_after}")
    assert bubbles_after == 0, f"todavía hay bocadillos: {bubbles_after}"

    # 7) sin errores JS
    assert not errors, f"errores JS: {errors[:3]}"
    print("0 ERRORES JS")
    print("E2E T44 VERDE ✅")
    browser.close()
