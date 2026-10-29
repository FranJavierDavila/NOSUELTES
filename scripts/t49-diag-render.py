#!/usr/bin/env python3
"""Diagnóstico del modelo invisible: inspecciona las mallas del GLB en vivo."""
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

DIAG = r"""
() => {
  const wrap = (__SHERPAS_DEBUG.sceneObj && __SHERPAS_DEBUG.sceneObj()) || null;
  const sc = wrap && wrap.scene ? wrap.scene : wrap;
  if (!sc || !sc.meshes) return "sin escena";
  const out = { glbMeshes: [], activeCount: 0, skeletons: [] };
  const act = sc.getActiveMeshes ? sc.getActiveMeshes() : null;
  out.activeCount = act ? act.length : -1;
  const activeSet = new Set();
  if (act) for (let i = 0; i < act.length; i++) { const q = act[i]; if (q && q.uniqueId !== undefined) activeSet.add(q.uniqueId); }
  for (const m of sc.meshes) {
    const n = m.name || "";
    if (!/jumpsuit|boots|gloves|cap|head|glass|box001/i.test(n)) continue;
    try {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const sk = m.skeleton;
      out.glbMeshes.push({
        name: n,
        visible: m.isVisible,
        enabled: m.isEnabled(),
        active: activeSet.has(m.uniqueId),
        always: m.alwaysSelectAsActiveMesh,
        pos: { x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) },
        parent: m.parent ? (m.parent.name || "?") : null,
        minW: { x: +bb.minimumWorld.x.toFixed(2), y: +bb.minimumWorld.y.toFixed(2), z: +bb.minimumWorld.z.toFixed(2) },
        maxW: { x: +bb.maximumWorld.x.toFixed(2), y: +bb.maximumWorld.y.toFixed(2), z: +bb.maximumWorld.z.toFixed(2) },
        mat: m.material ? m.material.name : null,
        alpha: m.material ? m.material.alpha : null,
        visibility: m.visibility,
        hasSkeleton: !!sk,
        bones: sk ? sk.bones.length : 0,
      });
    } catch (e) { out.glbMeshes.push({ name: n, err: String(e) }); }
  }
  for (const sk of sc.skeletons) {
    if (!sk.bones || !sk.bones.length) continue;
    const hips = sk.bones.find(b => /Hips/.test(b.name));
    if (!hips) continue;
    const tn = hips.getTransformNode();
    out.skeletons.push({
      name: sk.name,
      linked: !!tn,
      hipsPos: tn ? { x: +tn.position.x.toFixed(2), y: +tn.position.y.toFixed(2), z: +tn.position.z.toFixed(2) } : null,
      hipsParent: tn && tn.parent ? (tn.parent.name || "?") : null,
      hipsWorld: tn ? (() => { const w = tn.getWorldMatrix(); return { tx: +w.m[12].toFixed(2), ty: +w.m[13].toFixed(2), tz: +w.m[14].toFixed(2) }; })() : null,
      hipsLocalQuat: tn && tn.rotationQuaternion ? { x: +tn.rotationQuaternion.x.toFixed(3), y: +tn.rotationQuaternion.y.toFixed(3), z: +tn.rotationQuaternion.z.toFixed(3), w: +tn.rotationQuaternion.w.toFixed(3) } : null,
    });
  }
  return out;
}
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors, console = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") else None)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=8000)
    page.click("button[data-a=go]")
    # esperar el hook con timeout propio
    t0 = time.time()
    while time.time() - t0 < 20:
        if page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined'"):
            break
        page.wait_for_timeout(250)
    assert page.evaluate("typeof __SHERPAS_DEBUG !== 'undefined'"), "hook no creado"
    t0 = time.time()
    c = None
    while time.time() - t0 < 30:
        c = page.evaluate("__SHERPAS_DEBUG.climber ? __SHERPAS_DEBUG.climber() : null")
        if c and c.get("players") == [True, True]:
            break
        page.wait_for_timeout(300)
    print("climber:", json.dumps(c))
    page.wait_for_timeout(700)
    diag = page.evaluate(DIAG)
    print(json.dumps(diag, indent=1, ensure_ascii=False))
    print("pageerror:", errors[:3])
    print("console err/warn:", console[:6])
    browser.close()
