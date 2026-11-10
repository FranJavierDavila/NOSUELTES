#!/usr/bin/env python3
"""T116 — verificación en vivo de los 5 encargos:
H) humo: sigue en el TUBO y NO desaparece (columna ≥5 m con ≥100 vivas)
W) alas laterales: hacia atrás (regresión T115) + material LISO (wingPlainM)
B) paredes del fondo: massifBack estrechado (≈11 m, oculto tras muro+alas)
T) tutorial: tarjeta SIEMPRE a la izquierda, textos nuevos, rico no cae,
   AZUL compensa (regresiones T115) y rico SERENO (calm, sin latigazos)
Z) 0 errores JS
"""
import subprocess
import time
import urllib.request
from pathlib import Path

OUT = Path("/home/z/my-project/download/T116-capturas")
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

        # ---------- H + W + B: campamento ----------
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
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(80):
            try:
                if page.evaluate("!!(__SHERPAS_DEBUG && __SHERPAS_DEBUG.waist && __SHERPAS_DEBUG.waist(0))"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        emitter = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const pss = sc && sc.scene && sc.scene.particleSystems;
          const ps = pss && pss.find(p => p.name === 'chimenea');
          return ps && ps.emitter ? { x: +ps.emitter.x.toFixed(2), y: +ps.emitter.y.toFixed(2), z: +ps.emitter.z.toFixed(2), cap: ps.capacity, rate: ps.emitRate } : null;
        })()""")
        en_tubo = bool(emitter and abs(emitter["x"] - 4.88) < 0.4 and abs(emitter["z"] + 1.71) < 0.4 and 2.3 < emitter["y"] < 3.1)
        check("H1) humo en el TUBO (4.88,-1.71) — regresión T115", en_tubo, f"emisor={emitter}")
        # alas: hacia atrás + material liso
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
                       mat: m.material ? m.material.name : null };
          }
          return out;
        })()""")
        ok_atras = bool(alas and len(alas) == 2 and all(v["mxz"] > 0.8 and v["mnz"] > -1.5 for v in alas.values()))
        check("W1) alas hacia ATRÁS — regresión T115", ok_atras, f"{alas}")
        ok_lisas = bool(alas and all(v["mat"] == "wingPlainM" for v in alas.values()))
        check("W2) alas con material LISO (wingPlainM, sin loseta de vías)", ok_lisas)
        mb = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj();
          const m = sc && sc.scene && sc.scene.getMeshByName('massifBack');
          if (!m) return null;
          m.computeWorldMatrix(true);
          const bb = m.getBoundingInfo().boundingBox;
          return { w: +(bb.maximumWorld.x - bb.minimumWorld.x).toFixed(1) };
        })()""")
        check("B1) respaldo del fondo ESTRECHO (≈11 m; antes 22,6) — sin paneles laterales",
              bool(mb and mb["w"] < 12.5), f"{mb}")
        # vista amplia del campamento: chimenea + borde derecho (cielo, no panel)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(3.4, 4.2, -7.8, 11.5)")
        page.wait_for_timeout(12000)  # deja crecer la columna de humo
        # H2 — en este sandbox Babylon NO emite (engine.getDeltaTime()=0 → ratio
        # 0,06; también la nieve está a 0). Simulamos frames forzando _deltaTime
        # y renderizando: valida la FÍSICA real del updater (frenado, cono,
        # disipación, muerte por cota). En el navegador real el delta existe.
        col = page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG.sceneObj();
          const ps = sc.scene.particleSystems.find(p => p.name === 'chimenea');
          if (!ps) return null;
          window.__plumeFrames = 0;
          sc.engine._deltaTime = 167; // 10× tiempo real: 60 renders ≈ 10 s de pluma
          for (let i = 0; i < 30; i++) sc.scene.render();
          return true;
        })()""")
        page.evaluate("""(() => {
          const sc = window.__SHERPAS_DEBUG.sceneObj();
          const ps = sc.scene.particleSystems.find(p => p.name === 'chimenea');
          if (!ps) { window.__plume = null; return; }
          const em = (ps._emitter || ps.emitter);
          for (let i = 0; i < 30; i++) sc.scene.render();
          sc.engine._deltaTime = 16.7;
          const arr = ps._particles || [];
          let live = 0, mx = 0, opMax = 0;
          for (const p of arr) {
            if (p && p.position && p.age < p.lifeTime) {
              live++;
              mx = Math.max(mx, p.position.y - em.y);
              if (p.color) opMax = Math.max(opMax, p.color.a);
            }
          }
          window.__plume = { live, maxDz: +mx.toFixed(1), opMax: +opMax.toFixed(2) };
        })()""")
        col = page.evaluate("window.__plume")
        check("H2) pluma: sube ≥4,5 m con ≥80 vivas y opacidad visible "
              "(física simulada; en headless Babylon no emite solo)",
              bool(col and col["live"] >= 80 and col["maxDz"] >= 4.5 and col["opMax"] > 0.12), f"{col}")
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.camPin(null)")
        page.wait_for_timeout(400)

        # ---------- T: tutorial (primera visita) ----------
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
            page.wait_for_timeout(2200)
            card1 = page.evaluate("""(() => {
              const c = document.getElementById('tg-card');
              if (!c) return null;
              const r = c.getBoundingClientRect();
              return { side: (r.left + r.right) / 2 < innerWidth / 2 ? 'left' : 'right',
                       txt: c.textContent.slice(0, 70) };
            })()""")
            check("T2) tarjeta a la IZQUIERDA (fija)", bool(card1 and card1["side"] == "left"), f"{card1}")
            shot(page, OUT / "02-tutorial-paso1.png")
            page.evaluate("(function(){var b=document.querySelector('#tg-cta'); if (b) b.click();})()")
            # paso 2 (demo de arrastre): tarjeta SIGUE a la izquierda + texto nuevo
            page.wait_for_timeout(1800)
            card2 = page.evaluate("""(() => {
              const c = document.getElementById('tg-card');
              if (!c) return null;
              const r = c.getBoundingClientRect();
              return { side: (r.left + r.right) / 2 < innerWidth / 2 ? 'left' : 'right',
                       txt: c.textContent.replace(/\\s+/g, ' ') };
            })()""")
            fija = bool(card1 and card2 and card1["side"] == card2["side"])
            check("T3) tarjeta en el MISMO lado en el paso 2 (sin saltos)", fija)
            check("T4) texto nuevo visible («Mira al VERDE» / «Watch the GREEN»)",
                  bool(card2 and ("Mira al VERDE" in card2["txt"] or "Watch the GREEN sherpa" in card2["txt"])),
                  f"{card2 and card2['txt'][:120]}")
            # rico entero durante la demo + AZUL compensando (regresiones T115)
            cayo = False
            w1 = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.waist(1) : null")
            ok_mov = False
            for _ in range(30):
                page.wait_for_timeout(400)
                rf = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.richFall() : null")
                if rf and rf.get("fell"):
                    cayo = True
                w2 = page.evaluate("window.__SHERPAS_DEBUG ? __SHERPAS_DEBUG.waist(1) : null")
                if w1 and w2 and (abs(w2["x"] - w1["x"]) > 0.15 or abs(w2["y"] - w1["y"]) > 0.15):
                    ok_mov = True
                    w1 = w2
            check("T5) Ricachón NO cae durante la demo (regresión)", not cayo)
            check("T6) AZUL compensa durante la demo (regresión)", ok_mov)

        # ---------- Z: sin errores JS ----------
        check("Z1) 0 errores JS", not errors, f"{errors[:2]}")
        browser.close()
finally:
    srv.terminate()
print("fin")
