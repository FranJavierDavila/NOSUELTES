#!/usr/bin/env python3
"""Diagnóstico in-page: ¿el PBD de pasoRicachon puede cerrar los huesos con el
nudo vivo? Clona richi, fija los pies al nudo actual y relaja 10 pasadas en
JS puro; compara las desviaciones antes/después y el efecto de dt."""
import subprocess, time, urllib.request
srv = subprocess.Popen(["python3", "/home/z/my-project/scripts/sirve-out-subruta.py", "3100"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen("http://127.0.0.1:3100/NOSUELTES/", timeout=1); break
    except Exception:
        time.sleep(0.5)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required",
                                     "--disable-dev-shm-usage"])
        pg = b.new_context(viewport={"width": 1280, "height": 720}).new_page()
        pg.goto("http://127.0.0.1:3100/NOSUELTES/?nivel=pared", wait_until="domcontentloaded")
        for _ in range(150):
            pg.wait_for_timeout(500)
            if pg.evaluate("!!window.__PARED"):
                break
        pg.wait_for_timeout(12000)
        js = """
() => {
  const w = window.__PARED;
  const B = w.richi.map(c => ({ pos: {...c.pos}, prev: {...c.prev} }));
  const mid = w.ropeNodes.length >> 1;
  const nudo = {...w.ropeNodes[mid].pos};
  const HUESOS = [[2,1,0.34],[1,0,0.24],[1,3,0.22],[3,5,0.21],[1,4,0.22],[4,6,0.21],[2,7,0.33],[7,9,0.31],[2,8,0.33],[8,10,0.31]];
  const PIE = [9, 10];
  const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
  const peor = (bs) => Math.max(...HUESOS.map(([a, bb, r]) => Math.abs(dist(bs[a], bs[bb]) - r)));
  const antes = peor(B);
  // replicar EXACTamente el PBD del módulo (pies clavados al nudo actual)
  for (let pass = 0; pass < 10; pass++) {
    for (const i of PIE) { B[i].pos = { x: nudo.x + (i === 9 ? -0.06 : 0.06), y: nudo.y - 0.13, z: nudo.z - 0.06 }; }
    for (const [a, bb, rest] of HUESOS) {
      const pa = B[a].pos, pb = B[bb].pos;
      const d = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      if (d < 1e-6) continue;
      const f = ((d - rest) / d) * 0.5;
      const fx = (pb.x - pa.x) * f, fy = (pb.y - pa.y) * f, fz = (pb.z - pa.z) * f;
      if (!PIE.includes(a)) { pa.x += fx; pa.y += fy; pa.z += fz; }
      if (!PIE.includes(bb)) { pb.x -= fx; pb.y -= fy; pb.z -= fz; }
    }
  }
  for (const i of PIE) { B[i].pos = { x: nudo.x + (i === 9 ? -0.06 : 0.06), y: nudo.y - 0.13, z: nudo.z - 0.06 }; }
  const despues = peor(B);
  const dChest = Math.abs(Math.hypot(B[1].pos.x - B[2].pos.x, B[1].pos.y - B[2].pos.y, B[1].pos.z - B[2].pos.z) - 0.34);
  return { antes: +antes.toFixed(3), despues: +despues.toFixed(3), chestTrasPasadas: +dChest.toFixed(3),
           nudoY: +nudo.y.toFixed(2), piedY: +B[9].pos.y.toFixed(2), chestY: +B[1].pos.y.toFixed(2), pelvisY: +B[2].pos.y.toFixed(2) };
}
"""
        for k in range(5):
            print(k, pg.evaluate(js), flush=True)
            pg.wait_for_timeout(900)
        b.close()
finally:
    srv.kill()
