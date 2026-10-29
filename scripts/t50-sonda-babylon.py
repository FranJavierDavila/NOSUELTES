#!/usr/bin/env python3
"""Sonda viva: cómo interpreta Babylon el escalador.glb (matrices reales).
Compara: node scaling/pos/quat de Hips, IBM de Babylon vs Python, mundo de mallas."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

PROBE = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.skeletons) return { err: "sin escena" };
  const out = { bones: [], meshes: [], nodes: [] };
  // 1) esqueleto del modelo (el de 79 huesos)
  for (const sk of sc.skeletons) {
    if (!sk.bones || sk.bones.length < 50) continue;
    const skel = { name: sk.name, bones: sk.bones.length, samples: [] };
    for (const bn of ["Hips", "LeftArm", "LeftForeArm", "LeftUpLeg", "Head"]) {
      const b = sk.bones.find(x => (x.name || "").includes(bn));
      if (!b) continue;
      const tn = b.getTransformNode();
      const s = {
        name: b.name,
        linked: !!tn,
        scaling: tn ? { x: +tn.scaling.x.toFixed(5), y: +tn.scaling.y.toFixed(5), z: +tn.scaling.z.toFixed(5) } : null,
        pos: tn ? { x: +tn.position.x.toFixed(3), y: +tn.position.y.toFixed(3), z: +tn.position.z.toFixed(3) } : null,
        parent: tn && tn.parent ? (tn.parent.name || "?") : null,
        parentScaling: tn && tn.parent ? { x: +tn.parent.scaling.x.toFixed(5), y: +tn.parent.scaling.y.toFixed(5), z: +tn.parent.scaling.z.toFixed(5) } : null,
        parentPos: tn && tn.parent ? { x: +tn.parent.position.x.toFixed(3), y: +tn.parent.position.y.toFixed(3), z: +tn.parent.position.z.toFixed(3) } : null,
        restQuat: tn && tn.rotationQuaternion ? { x: +tn.rotationQuaternion.x.toFixed(4), y: +tn.rotationQuaternion.y.toFixed(4), z: +tn.rotationQuaternion.z.toFixed(4), w: +tn.rotationQuaternion.w.toFixed(4) } : null,
        // mundo ACTUAL del nodo (¡ya posado por la física!)
        worldT: (() => { try { tn.computeWorldMatrix(true); const w = tn.getWorldMatrix(); return { tx: +w.m[12].toFixed(3), ty: +w.m[13].toFixed(3), tz: +w.m[14].toFixed(3) }; } catch (e) { return null; } })(),
      };
      // IBM de babylon
      try {
        const ibm = b.getInverseBindMatrix ? b.getInverseBindMatrix() : null;
        if (ibm) s.ibm = { m: Array.from(ibm.m).map(v => +v.toFixed(4)) };
      } catch (e) { s.ibmErr = String(e); }
      skel.samples.push(s);
    }
    out.bones.push(skel);
  }
  // 2) mallas del modelo
  for (const m of sc.meshes) {
    if (!/jumpsuit|boots|gloves|cap|glass|box001/i.test(m.name || "")) continue;
    try {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      out.meshes.push({
        name: m.name,
        pos: { x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) },
        scaling: { x: +m.scaling.x.toFixed(5), y: +m.scaling.y.toFixed(5), z: +m.scaling.z.toFixed(5) },
        parent: m.parent ? (m.parent.name || "?") : null,
        parentScaling: m.parent ? { x: +m.parent.scaling.x.toFixed(5), y: +m.parent.scaling.y.toFixed(5), z: +m.parent.scaling.z.toFixed(5) } : null,
        minW: { x: +bb.minimumWorld.x.toFixed(2), y: +bb.minimumWorld.y.toFixed(2), z: +bb.minimumWorld.z.toFixed(2) },
        maxW: { x: +bb.maximumWorld.x.toFixed(2), y: +bb.maximumWorld.y.toFixed(2), z: +bb.maximumWorld.z.toFixed(2) },
        hasSkeleton: !!m.skeleton,
        numBoneInfluencers: m.numBoneInfluencers,
        matName: m.material ? m.material.name : null,
        albedoTexture: !!(m.material && m.material.albedoTexture),
        albedoColor: m.material ? { r: +m.material.albedoColor.r.toFixed(2), g: +m.material.albedoColor.g.toFixed(2), b: +m.material.albedoColor.b.toFixed(2) } : null,
        metallic: m.material ? +m.material.metallic.toFixed(2) : null,
      });
    } catch (e) { out.meshes.push({ name: m.name, err: String(e) }); }
  }
  return out;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
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
    t0 = time.time()
    while time.time() - t0 < 25:
        if page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' && !!__SHERPAS_DEBUG.climber"):
            break
        page.wait_for_timeout(300)
    t0 = time.time()
    while time.time() - t0 < 30:
        c = page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined' ? (__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null) : null")
        if c and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    page.wait_for_timeout(800)
    r = page.evaluate(PROBE)
    with open("/tmp/sonda-full.json", "w") as f:
        json.dump(r, f, indent=1)
    print(json.dumps(r, indent=1)[:6000])
    print("ERRORES JS:", errors[:2])
    browser.close()
