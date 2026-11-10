#!/usr/bin/env python3
"""T115 — sonda de la BOCA DE LA CHIMENEA: el clúster T114 (vértices por
encima de maxY−0.25) pilló el POSTE DE BANDERILLAS (más alto que el tubo,
captura del jugador con X roja). Aquí se disecciona la malla horneada por
FRANJAS de altura con clústeres xz para VER ambos mástiles y elegir la regla
que distingue el tubo (grueso, con tapa) del poste (fino, lateral)."""
import json
import subprocess
import time
import urllib.request

BASE = "http://127.0.0.1:3120/NOSUELTES"

srv = subprocess.Popen(
    ["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3120"],
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
            "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=300",
        ])
        page = browser.new_context(viewport={"width": 960, "height": 640}).new_page()
        page.goto(BASE, wait_until="domcontentloaded")
        for _ in range(240):
            try:
                bc = page.evaluate(
                    "window.__SHERPAS_DEBUG && __SHERPAS_DEBUG.baseCamp ? __SHERPAS_DEBUG.baseCamp() : null")
                if bc:
                    break
            except Exception:
                pass
            page.wait_for_timeout(500)
        page.wait_for_timeout(2500)
        out = page.evaluate(r"""(() => {
          const dbg = window.__SHERPAS_DEBUG; const sc = dbg && dbg.sceneObj && dbg.sceneObj();
          if (!sc || !sc.scene) return { err: 'sin escena' };
          const B = sc.scene;
          let bocaActual = null;
          for (const ps of (B.particleSystems || [])) {
            if (ps.name === 'chimenea' && ps.emitter) bocaActual = {
              x: +ps.emitter.x.toFixed(3), y: +ps.emitter.y.toFixed(3), z: +ps.emitter.z.toFixed(3) };
          }
          let res = null;
          for (const m of B.meshes) if (m.name === 'tripo_node_e97174b1') {
            m.computeWorldMatrix(true);
            const pos = m.getVerticesData('position');
            const M = m.getWorldMatrix().m;
            const world = [];
            let maxY = -1e9;
            for (let i = 0; i < pos.length; i += 3) {
              const x = pos[i], y = pos[i+1], z = pos[i+2];
              const v = { x: M[0]*x + M[4]*y + M[8]*z + M[12],
                          y: M[1]*x + M[5]*y + M[9]*z + M[13],
                          z: M[2]*x + M[6]*y + M[10]*z + M[14] };
              world.push(v);
              if (v.y > maxY) maxY = v.y;
            }
            // FRANJAS de 8 cm: clústeres compactos (union de celdas 7 cm)
            const CELL = 0.07, FRANJA = 0.08;
            const franjas = [];
            for (let top = maxY; top > maxY - 1.3; top -= FRANJA) {
              const pts = world.filter(v => v.y > top - FRANJA && v.y <= top);
              if (pts.length < 4) { franjas.push({ top: +top.toFixed(2), n: pts.length, cl: [] }); continue; }
              // clúster por celdas conectadas (4-vecinos)
              const grid = new Map();
              for (const p of pts) {
                const k = Math.round(p.x / CELL) + ':' + Math.round(p.z / CELL);
                if (!grid.has(k)) grid.set(k, []);
                grid.get(k).push(p);
              }
              const seen = new Set(); const cl = [];
              for (const k of grid.keys()) {
                if (seen.has(k)) continue;
                const stack = [k]; seen.add(k); const comp = [];
                while (stack.length) {
                  const ck = stack.pop();
                  for (const p of (grid.get(ck) || [])) comp.push(p);
                  const [cx, cz] = ck.split(':').map(Number);
                  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
                    const nk = (cx+dx) + ':' + (cz+dz);
                    if (grid.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
                  }
                }
                if (comp.length < 4) continue;
                let sx=0, sz=0, mnx=1e9, mxx=-1e9, mnz=1e9, mxz=-1e9;
                for (const p of comp) {
                  sx += p.x; sz += p.z;
                  if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
                  if (p.z < mnz) mnz = p.z; if (p.z > mxz) mxz = p.z;
                }
                cl.push({ cx: +(sx/comp.length).toFixed(3), cz: +(sz/comp.length).toFixed(3),
                          n: comp.length, xSpan: +(mxx-mnx).toFixed(2), zSpan: +(mxz-mnz).toFixed(2) });
              }
              cl.sort((a, b) => b.n - a.n);
              franjas.push({ top: +top.toFixed(2), n: pts.length, cl: cl.slice(0, 3) });
            }
            res = { maxY: +maxY.toFixed(3), franjas };
          }
          return { bocaActual, res };
        })()""")
        print(json.dumps(out, indent=1, ensure_ascii=False))
        browser.close()
finally:
    srv.terminate()
