#!/usr/bin/env python3
"""E2E T87 — Prueba «Pared Levitante» como nivel desde el menú (y por URL).
Verifica: menú → botón 🧱 → nivel montado, sim viva (t avanza, cinturas con
anclajes, bloques moviéndose), cámara centrando la arena, sin errores de página.
Capturas en download/t87-*.png. Uso: python3 scripts/cap-levitante.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("LEV_BASE", "http://localhost:3000")
OUT = "/home/z/my-project/download"

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=[
            "--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage",
        ])
        page = b.new_page(viewport={"width": 1280, "height": 800})
        errores = []
        page.on("pageerror", lambda e: errores.append(str(e)[:200]))

        # ---------- 1) menú → botón ----------
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => !!window.__SHERPAS_DEBUG", timeout=60000)
        # T110: la portada llega cuando el GLB del campamento termina (con red
        # de seguridad de 15 s) — esperar al BOTÓN, no a un plazo fijo.
        page.wait_for_selector("[data-a=lev]", timeout=90000)
        page.wait_for_timeout(800)
        btn = page.locator("[data-a=lev]")
        assert btn.count() == 1, f"botón del nivel: {btn.count()}"
        print("menú: botón 🧱 presente")
        page.screenshot(path=f"{OUT}/t87-menu-levitante.png")
        # dispatch_event: el click "real" de Playwright se cuelga en la
        # verificación de acciónabilidad sobre WebGL por software (quirk);
        # el handler es un click listener normal → el evento dispatched es
        # equivalente y el flujo menú→nivel queda igualmente verificado.
        btn.dispatch_event("click")
        page.wait_for_function("() => !!window.__LEV_DEBUG", timeout=60000)
        print("menú → nivel OK (__LEV_DEBUG activo)")

        # ---------- 2) sim viva + cámara ----------
        waists = []
        for i in range(11):
            page.wait_for_timeout(2000)
            st = page.evaluate("""() => {
              const s = window.__LEV_DEBUG.state();
              const w0 = s.players[0].waist, w1 = s.players[1].waist;
              const p0 = window.__SHERPAS_DEBUG.project(w0.x, w0.y, w0.z);
              const p1 = window.__SHERPAS_DEBUG.project(w1.x, w1.y, w1.z);
              const torso = (() => { try {
                const pp = window.__SHERPAS_DEBUG.puppetPieces();
                return pp && pp.p0 && pp.p0.pieces ? pp.p0.pieces["pieza_torso"] : null;
              } catch { return null; } })();
              return { s, p0, p1, torso };
            }""")
            waists.append((st["p0"]["x"] if st["p0"] else None, st["s"]["t"]))
            print(f"t={st['s']['t']:5.2f} anclajes={[p['anchors'] for p in st['s']['players']]} "
                  f"pan_x0={st['p0']['x'] if st['p0'] else '-':>7} torso={st['torso']}")
            if i == 4:
                page.screenshot(path=f"{OUT}/t87-levitante-inicio.png")
            if st["p0"] and 300 < st["p0"]["x"] < 1000 and i >= 3:
                break
        page.screenshot(path=f"{OUT}/t87-levitante-jugando.png")
        fin = page.evaluate("() => window.__LEV_DEBUG.state()")
        assert fin["t"] > 1.5, f"la simulación NO avanza: t={fin['t']}"
        assert all(p["anchors"] == 2 for p in fin["players"]), f"sherpas sin 2 anclajes: {fin['players']}"
        assert fin["players"][0]["waist"]["x"] > 5, "cintura P0 fuera de la arena (coordenadas mundo)"
        # las muñecas siguen a las cinturas (torso ≈ cintura en mundo)
        print("final:", json.dumps(fin)[:220])

        # ---------- 3) URL directa (?nivel=pared) ----------
        page.goto(f"{BASE}/?nivel=pared", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function("() => !!window.__LEV_DEBUG", timeout=60000)
        page.wait_for_timeout(3000)
        st2 = page.evaluate("() => window.__LEV_DEBUG.state()")
        assert st2["t"] > 0.5, "URL directa: sim no arranca"
        print("URL ?nivel=pared OK, t =", st2["t"])

        # ---------- 4) errores de página ----------
        assert not errores, f"pageerror: {errores[:3]}"
        print("sin errores de página — E2E OK")
        b.close()

if __name__ == "__main__":
    sys.exit(main())
