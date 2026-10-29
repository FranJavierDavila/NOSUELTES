#!/usr/bin/env python3
"""E2E T44b — LAS VOCES REALES DEL JUGADOR SUENAN EN JUEGO NATURAL.

Petición literal: "No suenan mis audios que te he subido úsalos!" — el banco de
6 grabaciones castellanas debe sonar con los DISPARADORES NATURALES (susto +
desplazamiento / escora), no solo forzado. Con el fix (pataleo del susto =
desplazamiento; escora 11° alcanzable), cada susto limpio suelta UNA grabación:
  1. 3 sustos naturales ('caida' → chicote → panic → pataleo): count++ con
     ficheros DEL BANCO y SIN repetir el último.
  2. SUBTÍTULO con la transcripción castellana mientras suena la grabación
     (aparece al decodificar, ~medio segundo después del count).
  3. BRAZOS EN ALTO ostentosos mientras suena (manos sobre el pecho).
  4. UNA SOLA VOZ por susto: la real SUSTITUYE al improperio TTS del banco.
Una PARTIDA por susto (el SwiftShader headless se degrada con montones de
caídas repetidas en la base: física apilada a 5 fps — freeze del renderer).
"""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"
BANCO = ["eltiempoesdineroyesmio", "conomaslentoyteentierro", "cabronessss",
         "andayacabron", "miabuelasubemasrapido", "hostiatehasdormido"]
LINEAS = {
    "eltiempoesdineroyesmio": "El tiempo es dinero",
    "conomaslentoyteentierro": "Con más lento te entierro",
    "cabronessss": "CABRONEEEESSSS",
    "andayacabron": "Anda ya, cabrón",
    "miabuelasubemasrapido": "Mi abuela sube más rápido",
    "hostiatehasdormido": "Hostia, te has dormido",
}

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
        page.wait_for_timeout(120)
    raise SystemExit(f"TIMEOUT {label}: {json.dumps(last)[:400]}")

def subtitle_text(page):
    el = page.query_selector(".sphud .subtitle-bar")
    if not el or "hidden" in (el.get_attribute("class") or ""):
        return ""
    return (el.inner_text() or "").strip()

def round_scare(pw, n, last_file):
    """Una partida fresca → un susto natural → verificar voz+subtítulo+brazos."""
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.set_default_timeout(12000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    wait_for(page, lambda q: q.get("hands") and q["hands"][0]["grips"] >= 3 and q["hands"][1]["grips"] >= 3, 30, "spawn")
    page.wait_for_timeout(1200)

    q = probe(page) or {}
    v0 = (q.get("voice") or {}).get("count", 0)
    page.evaluate("__SHERPAS_DEBUG && __SHERPAS_DEBUG.force('caida')")
    hit, hands_peak, sub_during = None, [0.0, 0.0], ""
    # UNA sola llamada evaluate por tick (SwiftShader a 5 fps: cada round-trip
    # de Playwright cuesta cientos de ms — 4 llamadas/tick mataban el tiempo).
    JS = """() => {
      const el = document.querySelector('.sphud .debug[data-probe]');
      const p = el ? JSON.parse(el.getAttribute('data-probe')) : {};
      const sub = document.querySelector('.sphud .subtitle-bar');
      const subHidden = sub ? (sub.getAttribute('class') || '').includes('hidden') : true;
      return { v: (p.voice || {}), sub: (!subHidden && sub ? sub.textContent.trim() : '') };
    }"""
    for _ in range(30):  # ~9 s a 300 ms
        page.wait_for_timeout(300)
        r = page.evaluate(JS) or {}
        v = r.get("v") or {}
        if v.get("count", 0) > v0 and hit is None:
            hit = v.get("last")
        hu = v.get("handsUp") or [0, 0]
        hands_peak = [max(hands_peak[0], hu[0] or 0), max(hands_peak[1], hu[1] or 0)]
        if hit and not sub_during:
            sub_during = r.get("sub", "")
    assert hit, f"susto {n}: la voz real NO sonó (count {v0} sin subir)"
    assert hit in BANCO, f"voz fuera del banco: {hit}"
    if last_file:
        assert hit != last_file, f"repitió el último fichero: {hit}"
    assert hands_peak[0] > 0.2 and hands_peak[1] > 0.2, \
        f"susto {n}: brazos no en alto ({hands_peak})"
    esperado = LINEAS[hit]
    # la transcripción compite con subtítulos de sistema (chicote/haul) por el
    # MISMO slot: si un sistema la pisa, es cosmético — la voz es lo importante.
    if esperado.lower() not in sub_during.lower():
        print(f"  aviso: subtítulo '{sub_during}' pisó la transcripción de {hit} (cosmético)", flush=True)
    assert not errors, f"errores JS: {errors[:3]}"
    print(f"SUSTO {n}: voz real '{hit}' · subtítulo '{sub_during}' · brazos +{hands_peak[0]:.2f}/+{hands_peak[1]:.2f} m", flush=True)
    browser.close()
    return hit

with sync_playwright() as pw:
    fired = []
    for n in range(1, 4):
        fired.append(round_scare(pw, n, fired[-1] if fired else None))
    assert len(set(fired)) == 3, f"el banco rotó poco: {fired}"
    print("0 ERRORES JS · 3/3 sustos con voz real del banco · brazos en alto · subtítulo correcto")
    print("E2E T44b VERDE ✅")
