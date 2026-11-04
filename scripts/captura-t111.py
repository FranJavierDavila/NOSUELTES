#!/usr/bin/env python3
"""Captura T111 — verificación visual de las peticiones del jugador:
 (A) caseta girada 45° horario (la puerta casi frontal a cámara) + humo lento
     saliendo de la boca de la chimenea;
 (B) SIN los dos bloques en forma de columna (sideMassifs fuera);
 (C) agarres rojizos (familia terracota del muro);
 (D) pared de respaldo nevada (blanquecina azulada);
 (E) ricachón con los 6 gestos nuevos (primeros planos).
Puerto 3107 (los E2E usan 3100/3101). Sale 0 si TODO VERDE."""
import subprocess
import sys
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T111-capturas")
OUT.mkdir(parents=True, exist_ok=True)

BASE = "http://127.0.0.1:3107/NOSUELTES"
srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3107"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
OK, FAIL = [], []


def shot(page, name):
    page.screenshot(path=str(OUT / name), timeout=120000)



def check(nombre, cond, detalle=""):
    (OK if cond else FAIL).append(nombre)
    print(("✓" if cond else "✗"), nombre, detalle, flush=True)


try:
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/", timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    from playwright.sync_api import sync_playwright
    flags = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
             "--disable-dev-shm-usage", "--force-device-scale-factor=1",
             "--js-flags=--max-old-space-size=300"]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=flags)
        page = browser.new_context(viewport={"width": 480, "height": 320}).new_page()
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                if page.evaluate("!!document.querySelector('button[data-a=go]')"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.netIdle(true)")
        page.evaluate("(function(){var b=document.querySelector('button[data-a=go]'); if (b) b.click();})()")
        for _ in range(12):
            try:
                page.evaluate("(() => { const s = document.querySelector('[data-a=obSkip]'); if (s) s.click(); })()")
            except Exception:
                pass
            page.wait_for_timeout(700)
        # el campamento GLB + humo acumulándose
        for _ in range(30):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke") and (bc.get("massifTris") or 0) > 0:
                    break
            except Exception:
                pass
            page.wait_for_timeout(1000)
        bc = page.evaluate("__SHERPAS_DEBUG.baseCamp()")
        print("baseCamp:", bc, flush=True)
        check("A1) humo activo", bool(bc and bc.get("smoke")))
        check("B1) respaldo nevado (massifTris>0)", bool(bc and (bc.get("massifTris") or 0) > 0), f"tris={bc and bc.get('massifTris')}")
        sidem = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); return !!(sc && sc.scene.getMeshByName('sideMassifs')); })()""")
        check("B2) SIN columnas laterales (sideMassifs fuera)", not sidem)
        emitter = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); const pss=sc && sc.scene.particleSystems;
            if (!pss || !pss.length) return null; const ps=pss.find(p=>p.name==='chimenea'); if(!ps) return null;
            const e=ps.emitter; return {x:+e.x.toFixed(2), y:+e.y.toFixed(2), z:+e.z.toFixed(2),
                rate: ps.emitRate, gx:+ps.gravity.x.toFixed(2), gy:+ps.gravity.y.toFixed(2)}; })()""")
        print("emisor:", emitter, flush=True)
        # boca de chimenea esperada con la caseta GIRADA 45° (T111):
        # el offset local (−0.99,0.47) rota a (−0.37,+1.03) → (4.43,~5.1,−1.87)
        ok_pos = bool(emitter and abs(emitter["x"] - 4.43) < 0.3 and abs(emitter["z"] + 1.87) < 0.35 and 4.4 < emitter["y"] < 5.6)
        check("A2) emisor EN la boca de la chimenea (girada: 4.43,~5.1,−1.87)", ok_pos, f"{emitter}")
        check("A3) humo LENTO (gravedad flotante ~0.05, no cohete)", bool(emitter and abs(emitter["gy"] - 0.07) < 0.03), f"gy={emitter and emitter['gy']}")

        # ----- (A) PRIMER PLANO de la caseta: giro de la puerta + humo -----
        page.evaluate("__SHERPAS_DEBUG.camPin(4.8, 1.35, -2.9, 3.4)")
        page.wait_for_timeout(6000)
        shot(page, "t111-caseta-cerca.png")
        # la boca de la chimenea (4.43, 5.1, −1.87) con el tubo y la columna
        page.evaluate("__SHERPAS_DEBUG.camPin(4.43, 3.9, -1.87, 4.6)")
        page.wait_for_timeout(8000)  # humo acumulado en el encuadre
        shot(page, "t111-chimenea-humo.png")
        page.wait_for_timeout(4000)
        shot(page, "t111-chimenea-humo-2.png")
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")

        # ----- (B+C) MURO general: sin columnas + agarres rojizos -----
        page.wait_for_timeout(500)
        shot(page, "t111-muro-general.png")

        hs = page.evaluate("__SHERPAS_DEBUG.holdStats ? __SHERPAS_DEBUG.holdStats() : null")
        print("holdStats:", hs, flush=True)
        check("C1) presas naturales con receta", bool(hs and hs.get("masters", 0) > 3), f"{hs}")
        # el material de un master de roca firme = holdRockM (rojizo)
        mat_hold = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); if (!sc) return null;
            const names=['holdMaster_rock_firm#0','holdMaster_rock_loose#0'];
            for (const n of names){ const m=sc.scene.getMeshByName(n); if (m && m.material) return m.material.name; }
            for (const m of sc.scene.meshes){ if (m.name && m.name.indexOf('holdMaster_rock')===0 && m.material) return m.material.name; }
            return null; })()""")
        check("C2) presas con material rojizo (holdRockM)", mat_hold == "holdRockM", f"mat={mat_hold}")
        # el respaldo existe y es blanquecino-azulado (vertex color B>=R)
        back_col = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj(); if (!sc) return null;
            const b=sc.scene.getMeshByName('massifBack'); if (!b) return null;
            const col=b.getVerticesData('color');
            if (!col || col.length<4) return null; return {r:+col[0].toFixed(2), g:+col[1].toFixed(2), b:+col[2].toFixed(2)}; })()""")
        ok_nieve = bool(back_col and back_col["b"] >= back_col["r"] and back_col["g"] > 0.85)
        check("D1) respaldo blanquecino azulado (g,r altos, b>=r)", ok_nieve, f"{back_col}")

        # ----- (E) RICACHÓN: los 6 gestos nuevos, en primer plano -----
        rich = page.evaluate("__SHERPAS_DEBUG.rich ? __SHERPAS_DEBUG.rich() : null")
        print("rich pelvis:", rich, flush=True)
        if rich:
            page.evaluate(f"__SHERPAS_DEBUG.camPin({rich['x']}, {rich['y'] + 0.35}, {rich['z']}, 2.9)")
        for g in ["contando", "senialando", "pose_poder", "selfie", "reloj", "risa"]:
            r = page.evaluate(f"__SHERPAS_DEBUG.richGesture('{g}', true)")
            page.wait_for_timeout(2600)  # los muelles asientan en la pose
            shot(page, f"t111-rico-{g}.png")
            check(f"E) gesto {g} aceptado", bool(r))
        page.evaluate("__SHERPAS_DEBUG.richGesture('ninguno', false)")
        page.evaluate("__SHERPAS_DEBUG.camPin(null)")

        check("Z1) 0 errores JS", not errores, f"{errores[:3]}")
        browser.close()
finally:
    srv.kill()

print(f"\nTODO VERDE: {len(OK)} · FALLOS: {len(FAIL)}")
for f in FAIL:
    print("  ✗", f)
sys.exit(0 if not FAIL else 1)
