#!/usr/bin/env python3
"""Sonda T52 v4 — ¿el orden de skel.bones de Babylon coincide con el orden de
skin.joints del GLB (lo que referencian los JOINTS_0)?"""
import json

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

PROBE = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  const m = sc.meshes.find(x => x.skeleton && x.skeleton.bones.length >= 50);
  if (!m) return { err: "no mesh" };
  const skel = m.skeleton;
  const boneOrder = skel.bones.map(b => (b.name || "?").replace("mixamorig:", ""));
  const idx = m.getVerticesData("matricesIndices");
  const uniq = [...new Set(Array.from(idx))].sort((a, b) => a - b);
  const referenced = uniq.map(i => boneOrder[i] ?? `#${i} FUERA`);
  return { bones: boneOrder, total: skel.bones.length, refsUnicos: uniq, referencedNames: referenced };
}
"""

GLB_JOINTS = """
import json, struct
data = open('/home/z/my-project/public/models/spiderman.glb','rb').read()
off = 12
while off < len(data):
    clen, ctype = struct.unpack_from('<II', data, off)
    if ctype == 0x4E4F534A:
        js = json.loads(data[off+8:off+8+clen].decode('utf-8')); break
    off += 8 + clen
sk = js['skins'][0]
print('GLB skin.joints (orden):')
print([js['nodes'][j].get('name','').replace('mixamorig:','') for j in sk['joints']])
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    for _ in range(3):
        try:
            page.click("text=SHERPAS AL LÍMITE", timeout=5000)
            break
        except Exception:
            page.wait_for_timeout(1000)
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    for _ in range(100):
        c = page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' ? (__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null) : null")
        if c and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    page.wait_for_timeout(600)
    r = page.evaluate(PROBE)
    print("Babylon skel.bones (orden de la paleta):")
    print(r["bones"])
    print(f"total={r['total']}")
    print(f"Object_7 referencias únicas JOINTS_0: {r['refsUnicos']}")
    print(f"→ huesos referenciados: {r['referencedNames']}")
    browser.close()

exec(GLB_JOINTS)
