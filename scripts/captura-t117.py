#!/usr/bin/env python3
"""T117 — verificación en vivo de los encargos del jugador:
W) alas laterales: MISMO material que el muro (massifRockM con loseta horneada)
   + hacia atrás (regresión T115) — revoca el liso del T116
T) tutorial:
   T1 tutorial vivo; T2 cámara DE FRENTE (yaw≈0: fuera la «losa gris»)
   T3 paso 2 en BUCLE: sigue en «Paso 2 de 11» a los 9 s (antes avanzaba solo),
      chip «en bucle» visible y CTA «Intentar yo»
   T4 CTA avanza a «Paso 3 de 11» (turno del ROJO)
Z) 0 errores JS
"""
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path("/home/z/my-project/download/T117-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3121/NOSUELTES"
PASS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, info: str = "") -> None:
    PASS.append((name, ok, info))
    print(("✓" if ok else "✗") + f" {name} {info}", flush=True)


def shot(page, path: Path, ms: int = 15000) -> bool:
    try:
        page.screenshot(path=str(path), timeout=ms)
        return True
    except Exception as e:
        print(f"  (shot fallido {path.name}: {str(e)[:60]})", flush=True)
        return False


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
        ctx = browser.new_context(viewport={"width": 760, "height": 520})
        page = ctx.new_page()
        page.set_default_timeout(20000)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- W: alas con material del muro ----------
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
        page.evaluate("localStorage.setItem('ns.onboarding.seen.v1','1')")
        alas = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          if (!sc || !sc.scene) return null;
          const out = {};
          for (const n of ['sideWallL', 'sideWallR']) {
            const m = sc.scene.getMeshByName(n);
            if (!m) continue;
            m.computeWorldMatrix(true);
            const bb = m.getBoundingInfo().boundingBox;
            out[n] = { mxz: +bb.maximumWorld.z.toFixed(2), mnz: +bb.minimumWorld.z.toFixed(2),
                       mat: m.material ? m.material.name : null,
                       baked: !!(m.material && m.material.albedoTexture) };
          }
          return out;
        })()""")
        ok_mat = bool(alas and len(alas) == 2 and all(v["mat"] == "massifRockM" for v in alas.values()))
        check("W1) alas con material DEL MURO (massifRockM)", ok_mat, f"{alas}")
        ok_bake = bool(alas and all(v["baked"] for v in alas.values()))
        check("W2) loseta horneada presente (albedoTexture ≠ null)", ok_bake)
        ok_atras = bool(alas and all(v["mxz"] > 0.8 and v["mnz"] > -1.5 for v in alas.values()))
        check("W3) alas hacia ATRÁS — regresión T115", ok_atras)
        shot(page, OUT / "W-alas.png")

        # ---------- T: tutorial ----------
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
                if page.evaluate("!!(__SHERPAS_DEBUG.baseCamp && __SHERPAS_DEBUG.baseCamp() && __SHERPAS_DEBUG.baseCamp().smoke)"):
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
            # T2 — cámara DE FRENTE en el paso 1 (yaw≈0, delante de la pared)
            page.wait_for_timeout(1600)  # plano del Ricachón (t<3.2 s)
            cam = page.evaluate("""(() => {
              const sc = window.__SHERPAS_DEBUG.sceneObj();
              const cam = sc.camera || (sc.scene && sc.scene.cameras && sc.scene.cameras[0]);
              if (!cam) return null;
              const p = cam.position, t = cam.getTarget();
              const yaw = Math.atan2(-(p.x - t.x), -(p.z - t.z));
              return { yaw: +yaw.toFixed(2), cz: +p.z.toFixed(1), tz: +t.z.toFixed(1) };
            })()""")
            ok_front = bool(cam and abs(cam["yaw"]) < 0.3 and cam["cz"] < cam["tz"])
            check("T2) cámara DE FRENTE (yaw≈0, cámara delante del objetivo) — fuera la losa gris",
                  ok_front, f"{cam}")
            shot(page, OUT / "T-paso1-ricachon.png")
            page.wait_for_timeout(2800)  # plano de la cima (t>3.2 s)
            shot(page, OUT / "T-paso1-cima.png")
            # avanzar al paso 2 con el CTA «Entendido» (clic JS: la capa HUD)
            page.evaluate("document.getElementById('tg-cta').click()")
            page.wait_for_timeout(900)
            badge = page.evaluate("document.getElementById('tg-badge') ? document.getElementById('tg-badge').textContent : ''")
            check("T3a) CTA «Entendido» → Paso 2 de 11", "2" in badge, f"badge='{badge}'")
            # en demo: chip de bucle + CTA «Intentar yo»
            ui2 = page.evaluate("""(() => ({
              loop: document.getElementById('tg-loop') ? !document.getElementById('tg-loop').classList.contains('hidden') : false,
              loopTxt: document.getElementById('tg-loop') ? document.getElementById('tg-loop').textContent.slice(0, 40) : '',
              cta: document.getElementById('tg-cta') ? document.getElementById('tg-cta').textContent : ''
            }))()""")
            check("T3b) chip «en bucle» visible", ui2["loop"], f"{ui2}")
            check("T3c) CTA «Intentar yo»", ui2["cta"].strip().startswith("Intentar") or "try" in ui2["cta"].lower(), f"cta='{ui2['cta']}'")
            shot(page, OUT / "T-paso2-demo.png")
            # T3d — el paso NO avanza solo: a los 9 s sigue en el 2 (antes ~4 s)
            page.wait_for_timeout(9000)
            badge9 = page.evaluate("document.getElementById('tg-badge') ? document.getElementById('tg-badge').textContent : ''")
            check("T3d) demo EN BUCLE: a los +9 s sigue «Paso 2 de 11» (no avanza solo)",
                  "2" in badge9, f"badge='{badge9}'")
            # T4 — CTA «Intentar yo» → paso 3 (turno del ROJO)
            page.evaluate("document.getElementById('tg-cta').click()")
            page.wait_for_timeout(900)
            st = page.evaluate("""(() => ({
              badge: document.getElementById('tg-badge') ? document.getElementById('tg-badge').textContent : '',
              now: document.getElementById('tg-now') ? !document.getElementById('tg-now').classList.contains('hidden') : false
            }))()""")
            check("T4) «Intentar yo» → Paso 3 de 11 (turno, banner AHORA TÚ)",
                  "3" in st["badge"] and st["now"], f"{st}")
            shot(page, OUT / "T-paso3-turno.png")

        ok_js = not errors
        check("Z) 0 errores JS", ok_js, f"{errors[:3]}")
        browser.close()
finally:
    srv.terminate()
    print("\n==== RESUMEN T117 ====")
    malas = [p for p in PASS if not p[1]]
    for n, ok, i in PASS:
        print(("✓" if ok else "✗"), n, i)
    print(f"{len(PASS) - len(malas)}/{len(PASS)} verdes")
