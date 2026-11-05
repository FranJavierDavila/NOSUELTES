#!/usr/bin/env python3
"""T112 — verificación en vivo: ALAS laterales (sideWallL/R) sustituyen a los
faldones; humo VISIBLE (grande/opaco); 0 errores JS; capturas de cada vista."""
import subprocess
import time
from pathlib import Path

OUT = Path("/home/z/my-project/download/T112-capturas")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3120/NOSUELTES"
PASS: list[tuple[str, bool, str]] = []

def check(name: str, ok: bool, info: str = "") -> None:
    PASS.append((name, ok, info))
    print(("✓" if ok else "✗") + f" {name} {info}", flush=True)

srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3120"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    import urllib.request
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
            "--js-flags=--max-old-space-size=300",
        ])
        errors: list[str] = []
        page = browser.new_context(viewport={"width": 480, "height": 320}).new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
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
        for _ in range(25):
            try:
                bc = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc and bc.get("smoke"):
                    break
            except Exception:
                pass
            page.wait_for_timeout(1000)

        bc = page.evaluate("window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
        check("A1) ALAS generadas (wingTris>0)", bool(bc and (bc.get("wingTris") or 0) > 1000), f"wingTris={bc and bc.get('wingTris')}")
        meshes = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const names=sc.scene.meshes.map(m=>m.name);
            return { L: names.filter(n=>n.startsWith('sideWall')).length, spurs: names.filter(n=>n==='spurs').length }; })()""")
        check("A2) mallas sideWallL+sideWallR presentes", meshes.get("L") == 2, f"n={meshes.get('L')}")
        check("A3) FALDONES fuera (mesh 'spurs' no existe)", meshes.get("spurs") == 0)
        emitter = page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const ps=sc.scene.particleSystems.find(p=>p.name==='chimenea');
            if (!ps) return null;
            const e=ps.emitter;
            return { x:+e.x.toFixed(2), y:+e.y.toFixed(2), z:+e.z.toFixed(2), rate: ps.emitRate }; })()""")
        check("B1) humo activo y reforzado (rate 26 en la boca girada)", bool(emitter and emitter.get("rate") == 26
              and abs(emitter["x"] - 4.43) < 0.3 and abs(emitter["z"] + 1.87) < 0.35), f"emitter={emitter}")

        def snap(name: str, pin: str, wait_ms: int = 9000) -> None:
            if pin:
                page.evaluate(f"__SHERPAS_DEBUG.camPin({pin})")
            page.wait_for_timeout(wait_ms)
            page.screenshot(path=str(OUT / name), timeout=120000)

        snap("t112-general.png", "")  # cámara del juego tal cual
        page.evaluate("""(() => { const sc=__SHERPAS_DEBUG.sceneObj();
            const m=sc.scene.getMeshByName('sideWallL');
            if(!m) return null; m.freezeWorldMatrix();
            const b=m.getBoundingInfo().boundingBox;
            const c=b.centerWorld; const ext=b.maximumWorld;
            return {x:c.x,y:ext.y*0.55,z:c.z}; })()""")
        snap("t112-ala-izquierda.png", "-7.3, 4.2, -1.3, 4.2")
        snap("t112-ala-derecha.png", "7.3, 4.2, -1.3, 4.2")
        snap("t112-chimenea.png", "4.43, 5.9, -3.2, 4.5", 14000)
        check("Z1) 0 errores JS", not errors, f"errs={errors[:2]}")
        browser.close()
finally:
    srv.kill()

fails = [n for n, ok, _ in PASS if not ok]
print(f"\nT112: VERDES {len(PASS) - len(fails)} · FALLOS {len(fails)}" + (": " + ", ".join(fails) if fails else ""), flush=True)
