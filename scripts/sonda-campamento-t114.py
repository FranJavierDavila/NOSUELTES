#!/usr/bin/env python3
"""T114 — sonda de las mallas del campamento base (GLB horneado): nombres,
bbox mundo y proyección a pantalla del emisor de humo actual vs. candidatos a
boca de chimenea. Sirve para fijar el emisor por GEOMETRÍA y no por magic numbers."""
import json
import subprocess
import time
import urllib.request
from pathlib import Path

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
        page.wait_for_timeout(3000)
        out = page.evaluate(r"""(() => {
          const dbg = window.__SHERPAS_DEBUG; const sc = dbg && dbg.sceneObj && dbg.sceneObj();
          if (!sc || !sc.scene) return { err: 'sin escena' };
          const B = sc.scene;
          const camp = [];
          for (const m of B.meshes) {
            try {
              if (!m.isEnabled || !m.isEnabled()) continue;
              m.computeWorldMatrix(true);
              const bb = m.getBoundingInfo && m.getBoundingInfo().boundingBox;
              if (!bb) continue;
              const mn = bb.minimumWorld, mx = bb.maximumWorld;
              if (mx.y > 12) continue; // solo la zona del campamento (suelo)
              camp.push({
                name: m.name, verts: m.getTotalVertices ? m.getTotalVertices() : -1,
                mn: [ +mn.x.toFixed(2), +mn.y.toFixed(2), +mn.z.toFixed(2) ],
                mx: [ +mx.x.toFixed(2), +mx.y.toFixed(2), +mx.z.toFixed(2) ],
              });
            } catch (e) {}
          }
          camp.sort((a, b) => b.verts - a.verts);
          const em = (B.particleSystems || []).map(ps => ps.name === 'chimenea' || (ps.emitter && !ps.name)
            ? { name: ps.name || '(sin nombre)', e: ps.emitter ? { x: +ps.emitter.x.toFixed(3), y: +ps.emitter.y.toFixed(3), z: +ps.emitter.z.toFixed(3) } : null, cap: ps.capacity } : null).filter(Boolean);
          const pr = (p) => dbg.project ? dbg.project(p.x, p.y, p.z) : null;
          const cerca = camp.filter(m => m.mx[0] > 2 && m.mn[0] < 8 && m.mx[1] < 9);
          // T114: boca del tubo por CLÚSTER de vértices superiores de la caseta
          let boca = null;
          for (const m of B.meshes) {
            if (m.name !== 'tripo_node_e97174b1') continue;
            m.computeWorldMatrix(true);
            const pos = m.getVerticesData('position');
            const M = m.getWorldMatrix().m; // fila-mayor; v' = M·v
            let maxY = -1e9;
            const world = [];
            for (let i = 0; i < pos.length; i += 3) {
              const x = pos[i], y = pos[i+1], z = pos[i+2];
              const v = {
                x: M[0]*x + M[4]*y + M[8]*z + M[12],
                y: M[1]*x + M[5]*y + M[9]*z + M[13],
                z: M[2]*x + M[6]*y + M[10]*z + M[14],
              };
              world.push(v);
              if (v.y > maxY) maxY = v.y;
            }
            boca = { maxY: +maxY.toFixed(3), cortes: [] };
            for (const corte of [0.12, 0.2, 0.3, 0.45]) {
              let sx = 0, sz = 0, n = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
              for (const v of world) if (v.y > maxY - corte) {
                sx += v.x; sz += v.z; n++;
                if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
                if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
              }
              boca.cortes.push({ c: corte, n, x: +(sx/n).toFixed(3), z: +(sz/n).toFixed(3), xSpan: +(maxX-minX).toFixed(3), zSpan: +(maxZ-minZ).toFixed(3) });
            }
          }
          return { nMeshes: camp.length, cerca, smoke: em, boca };
        })()""")
        print(json.dumps(out, indent=1, ensure_ascii=False))
        browser.close()
finally:
    srv.terminate()
