#!/usr/bin/env python3
"""T115 — verificación en vivo de los 5 encargos: (1) humo en el TUBO de la
chimenea (no en el poste), (2) alas laterales inclinadas HACIA ATRÁS sin
losa vertical trasera, (3) tutorial guiado sin caída del Ricachón + tarjeta
que esquiva la acción, (4) panel dev intacto, (5) 0 errores JS."""
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path("/home/z/my-project/download/T115-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3121/NOSUELTES"
PASS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, info: str = "") -> None:
    PASS.append((name, ok, info))
    print(("✓" if ok else "✗") + f" {name} {info}", flush=True)


srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3121"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
            "--disable-dev-shm-usage", "--force-device-scale-factor=1",
            "--js-flags=--max-old-space-size=420",
        ])
        errors: list[str] = []
        ctx = browser.new_context(viewport={"width": 900, "height": 600})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- F1: HUMO EN EL TUBO ----------
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        for _ in range(40):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        boca = page.evaluate("window.__SHERPAS_DEBUG ? (__SHERPAS_DEBUG.baseCamp().smokePos || null) : null")
        emitter = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const pss = sc && sc.scene && sc.scene.particleSystems;
          const ps = pss && pss.find(p => p.name === 'chimenea');
          return ps && ps.emitter ? { x: ps.emitter.x, y: ps.emitter.y, z: ps.emitter.z } : null;
        })()""")
        # el TUBO medido por la sonda de franjas: (4.875, ~2.59, -1.71)
        en_tubo = bool(emitter and abs(emitter["x"] - 4.88) < 0.4
                       and abs(emitter["z"] - (-1.71)) < 0.4 and 2.3 < emitter["y"] < 3.1)
        no_poste = bool(emitter and (abs(emitter["x"] - 5.96) > 0.4 or abs(emitter["z"] - (-3.62)) > 0.4))
        check("H1) humo en el TUBO (4.88,-1.71), NO en el poste (5.96,-3.62)",
              en_tubo and no_poste, f"emisor={emitter} boca={boca}")
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(4.6, 2.6, -1.2, 6.5)")
        page.wait_for_timeout(1800)
        page.screenshot(path=str(OUT / "01-chimenea-tubo.png"))
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(null)")
        page.wait_for_timeout(600)

        # ---------- F2: ALAS HACIA ATRÁS + SIN LOSA TRASERA ----------
        alas = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          if (!sc || !sc.scene) return null;
          const out = {};
          for (const n of ['sideWallL', 'sideWallR']) {
            const m = sc.scene.getMeshByName(n);
            if (!m) continue;
            m.computeWorldMatrix(true);
            const bb = m.getBoundingInfo().boundingBox;
            out[n] = { mnz: +bb.minimumWorld.z.toFixed(2), mxz: +bb.maximumWorld.z.toFixed(2),
                       mny: +bb.minimumWorld.y.toFixed(1), mxy: +bb.maximumWorld.y.toFixed(1) };
          }
          return out;
        })()""")
        # inclinadas hacia atrás = el ala se ALEJA de la cámara (z max BEHIND
        # la cara del muro, z≈0): la profundidad del ala vive en z POSITIVO
        ok_atras = bool(alas and all(
            v["mxz"] > 0.8 and v["mnz"] > -1.5 for v in alas.values())) and len(alas) == 2
        check("W1) alas inclinadas HACIA ATRÁS (cuerpo en z>0, hacia el fondo)", ok_atras, f"{alas}")
        # el ángulo de la cámara del jugador (captura 2): cerca de la cabaña
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(2.2, 3.4, -8.5, 9)")
        page.wait_for_timeout(1600)
        page.screenshot(path=str(OUT / "02-campanario-sin-losa.png"))
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(4.8, 1.6, -6.5, 7.5)")
        page.wait_for_timeout(1400)
        page.screenshot(path=str(OUT / "03-junta-ala-muro.png"))
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(null)")
        page.wait_for_timeout(500)

        # ---------- F3: TUTORIAL — rico NO cae + tarjeta que esquiva ----------
        page.evaluate("localStorage.removeItem('ns.onboarding.seen.v1')")
        page.reload(wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        for _ in range(40):
            try:
                if page.evaluate("!!window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.baseCamp && __SHERPAS_DEBUG.baseCamp() && __SHERPAS_DEBUG.baseCamp().smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(700)
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        tut = False
        for _ in range(80):
            try:
                if page.evaluate("!!document.getElementById('ns-tut-guiado') && !document.getElementById('ns-tut-guiado').classList.contains('hidden')"):
                    tut = True
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        check("T1) tutorial guiado vivo", tut)
        if tut:
            # tarjeta ESQUIVA: nunca centrada; su lado es el opuesto al foco
            page.wait_for_timeout(2500)
            dodge = page.evaluate("""(() => {
              const card = document.getElementById('tg-card');
              if (!card) return null;
              const r = card.getBoundingClientRect();
              const side = (r.left + r.right) / 2 < innerWidth / 2 ? 'left' : 'right';
              const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
              const f = (typeof __SHERPAS_DEBUG.waist === 'function') ? __SHERPAS_DEBUG.waist(0) : null;
              let focoSide = null;
              if (f && sc) {
                const p = __SHERPAS_DEBUG.project(f.x, f.y, f.z);
                if (p) focoSide = p.x > innerWidth / 2 ? 'right' : 'left';
              }
              const centrada = Math.abs((r.left + r.right) / 2 - innerWidth / 2) < innerWidth * 0.12;
              return { side, focoSide, centrada, w: Math.round(r.width) };
            })()""")
            check("T2) tarjeta en un LATERAL (no tapa el centro de acción)",
                  bool(dodge and not dodge.get("centrada")), f"{dodge}")
            # rico AGARRADO durante la demo: mirar richFall cada 0,4 s durante
            # el paso 1 y el arranque del paso 2 (la demo de arrastre escoraba
            # la tabla y ANTES lo despachaba)
            cayo = False
            for _ in range(60):
                rf = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.richFall() : null")
                if rf and rf.get("fell"):
                    cayo = True
                    break
                badge = page.evaluate("(document.querySelector('#tg-badge')||{}).textContent || ''")
                if "2" in badge:  # llegó al paso 2 con el rico entero
                    break
                page.wait_for_timeout(400)
            check("T3) el Ricachón NO cae durante el paso objetivo", not cayo)
            # compensación: durante la DEMO del paso 2 el AZUL (student) se mueve
            page.evaluate("(function(){var b=document.querySelector('#tg-cta'); if (b) b.click();})()")
            w1 = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.waist(1) : null")
            ok_mov = False
            for _ in range(40):
                page.wait_for_timeout(500)
                w2 = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.waist(1) : null")
                rf = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.richFall() : null")
                if rf and rf.get("fell"):
                    cayo = True
                if w1 and w2 and (abs(w2["x"] - w1["x"]) > 0.15 or abs(w2["y"] - w1["y"]) > 0.15):
                    ok_mov = True
                    break
            check("T4) el AZUL COMPENSA durante la demo del profesor (se mueve)", ok_mov, f"w1={w1}")
            check("T5) el Ricachón sigue SIN caerse en la demo de arrastre", not cayo)
            page.screenshot(path=str(OUT / "04-tutorial-demo-compensada.png"))
            page.evaluate("(function(){var b=document.querySelector('[data-a=obSkip]'); if (b) b.click();})()")
            page.wait_for_timeout(900)
            fuera = page.evaluate("document.getElementById('ns-tut-guiado').classList.contains('hidden')")
            vivo = page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))")
            check("T6) saltar cierra el tutorial y la partida SIGUE", fuera and vivo)
            page.screenshot(path=str(OUT / "05-partida-tras-skip.png"))

        # ---------- F4: panel dev intacto (regresión; en partida, sin recarga) ----------
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        page.keyboard.type("sherpa", delay=60)
        page.wait_for_timeout(600)
        panel = page.evaluate("!!document.getElementById('ns-dev-panel')")
        check("D1) modo dev sigue vivo (palabra secreta)", panel)

        check("Z1) 0 errores JS en toda la sesión", not errors, f"{errors[:2]}")
        browser.close()
finally:
    srv.terminate()

ok = sum(1 for _, o, _ in PASS if o)
print(f"\ncaptura-t115: {ok}/{len(PASS)} VERDE" + ("" if ok == len(PASS) else "  ← REVISAR"))
