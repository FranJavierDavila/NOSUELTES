#!/usr/bin/env python3
"""Diag T68 — ¿Están las presas ENTERRADAS en la roca?
Para ~12 presas: z de la malla de la presa vs z MÁXIMA de los vértices de roca
cerca de su (x,y). Si rocaZ > presaZ, la piedra cubre la presa (blister)."""
import sys
import time

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"


def ev(page, expr, tries=10):
    for _ in range(tries):
        try:
            return page.evaluate(expr)
        except Exception:
            page.wait_for_timeout(500)
    return None


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=[
        "--no-sandbox", "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    ])
    page = browser.new_page(viewport={"width": 960, "height": 600})
    page.goto(URL + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    page.wait_for_selector("button[data-a=go]", timeout=90000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(1500)
    for _ in range(8):
        try:
            avanzado = page.evaluate("""(() => {
              const b = document.querySelector('[data-a=obNext]');
              if (!b || !b.offsetParent) return false;
              b.click();
              return true;
            })()""")
        except Exception:
            avanzado = False
        if not avanzado:
            break
        page.wait_for_timeout(500)
    t0 = time.time()
    while time.time() - t0 < 150:
        try:
            ok = bool(page.evaluate("window.__SHERPAS_DEBUG && !!__SHERPAS_DEBUG.drag(0)"))
        except Exception:
            ok = False
        if ok:
            break
        page.wait_for_timeout(2000)
    page.wait_for_timeout(9000)

    out = ev(page, """(function(){
      const dbg = window.__SHERPAS_DEBUG;
      const sc = dbg && dbg.sceneObj ? dbg.sceneObj() : null;
      if (!sc) return { error: "sin escena" };
      const holds = dbg.holds ? dbg.holds().slice(0, 14) : [];
      const rockMeshes = [];
      for (const e of sc.reliefMeshes.values()) rockMeshes.push(e.mesh);
      const info = sc.getReliefInfo ? sc.getReliefInfo() : null;
      const style = sc.rockCtx ? {
        anchorBackM: sc.rockCtx.style.anchorBackM,
        plateauR: sc.rockCtx.style.plateauR,
        zFloorM: sc.rockCtx.style.zFloorM,
        zCeilM: sc.rockCtx.style.zCeilM,
        cell: sc.rockCtx.style.cell,
      } : null;
      const samples = [];
      for (const h of holds) {
        let zMax = -Infinity, zMin = Infinity;
        for (const m of rockMeshes) {
          const pos = m.getVerticesData("position");
          if (!pos) continue;
          for (let i = 0; i < pos.length; i += 9) { // cada 3º vértice
            const dx = pos[i] - h.x, dy = pos[i + 1] - h.y;
            if (dx * dx + dy * dy < 0.0049) { // radio 7 cm
              const z = pos[i + 2];
              if (z > zMax) zMax = z;
              if (z < zMin) zMin = z;
            }
          }
        }
        const inst = sc.holdMeshes ? sc.holdMeshes.get(h.id) : null;
        let knobZmax = null, knobZmin = null;
        if (inst) {
          const bb = inst.getBoundingInfo();
          knobZmax = +bb.boundingBox.maximumWorld.z.toFixed(3);
          knobZmin = +bb.boundingBox.minimumWorld.z.toFixed(3);
        }
        samples.push({
          x: +h.x.toFixed(2), y: +h.y.toFixed(2),
          holdZ: inst ? +inst.position.z.toFixed(3) : null,
          knobZmax, knobZmin,
          rockZmin: zMin === Infinity ? null : +zMin.toFixed(3),
          rockZmax: zMax === -Infinity ? null : +zMax.toFixed(3),
        });
      }
      return { faceZ: sc.reliefFaceZ, info, style, samples };
    })()""")
    browser.close()

if not out or out.get("error"):
    print("DIAG FALLO:", out)
    sys.exit(1)
print("faceZ:", out["faceZ"], " info:", out["info"])
print("style:", out["style"])
enterradas = 0
for s in out["samples"]:
    if s["holdZ"] is None or s["rockZmax"] is None:
        print(s); continue
    asiento = s["holdZ"] - s["rockZmax"]          # >0 → piedra DETRÁS del centro
    sobresale = (s["knobZmax"] or 0) - s["rockZmax"]  # knob fuera de la piedra
    if sobresale < 0.04:
        enterradas += 1
    print(f"  hold@({s['x']:>5},{s['y']:>6}) holdZ={s['holdZ']} asiento={asiento:+.3f} "
          f"knob=[{s['knobZmin']},{s['knobZmax']}] sobresale={sobresale:+.3f}")
print(f"\nCon knob poco visible (sobresale<40mm): {enterradas}/{len(out['samples'])}")
