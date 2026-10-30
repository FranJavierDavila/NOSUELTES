#!/usr/bin/env python3
"""Sonda T52: ¿los HUESOS del esqueleto caen sobre las PARTÍCULAS de física?
Compara posiciones mundo de nodos hueso (Hips/hombros/manos/pies) con las 15
partículas del ragdoll, y el mundo real del nodo _rootJoint vs el esperado."""
import json

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000"

JS = """
(() => {
  const dbg = window.__SHERPAS_DEBUG;
  if (!dbg || !dbg.sceneObj) return { error: "no debug" };
  const s = dbg.sceneObj();
  const scene = s.scene || s.getScene && s.getScene();
  if (!scene) return { error: "no scene" };
  const out = { bones: {}, particles: dbg.particles(0), root: null, meshes: [] };
  // esqueleto del primer mesh skinneado
  const skinned = scene.meshes.find(m => m.skeleton && m.name.includes("Object_9"));
  const skel = skinned ? skinned.skeleton : (scene.skeletons && scene.skeletons[0]);
  if (!skel) return { error: "no skeleton", meshes: scene.meshes.slice(0, 8).map(m => m.name) };
  out.skelName = skel.name;
  const want = ["Hips", "LeftArm", "LeftForeArm", "LeftHand", "LeftFoot", "LeftUpLeg", "Head", "Spine2"];
  for (const b of skel.bones) {
    const nm = (b.name || "").replace("mixamorig:", "");
    if (!want.some(w => nm.startsWith(w))) continue;
    const tn = b.getTransformNode && b.getTransformNode();
    if (!tn) continue;
    tn.computeWorldMatrix(true);
    const p = tn.getAbsolutePosition();
    const lp = tn.position;
    out.bones[nm] = { world: [p.x, p.y, p.z], local: [lp.x, lp.y, lp.z] };
  }
  // raíz del esqueleto: padre del nodo Hips
  const hips = skel.bones.find(b => (b.name || "").replace("mixamorig:", "").startsWith("Hips"));
  const hipsTn = hips && hips.getTransformNode();
  if (hipsTn && hipsTn.parent) {
    hipsTn.parent.computeWorldMatrix(true);
    const wp = hipsTn.parent.getAbsolutePosition();
    out.root = { name: hipsTn.parent.name, world: [wp.x, wp.y, wp.z] };
  }
  // mundo de las mallas skinneadas (escala)
  for (const m of scene.meshes) {
    if (!m.skeleton) continue;
    m.computeWorldMatrix(true);
    out.meshes.push({ name: m.name.slice(0, 30), world: [
      m.getWorldMatrix().m[0], m.getWorldMatrix().m[5], m.getWorldMatrix().m[10],
      m.getWorldMatrix().m[12], m.getWorldMatrix().m[13], m.getWorldMatrix().m[14]] });
    if (out.meshes.length >= 3) break;
  }
  return out;
})()
"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.click("text=SHERPAS AL LÍMITE")
    page.wait_for_selector("button[data-a=go]", timeout=10000)
    page.click("button[data-a=go]")
    page.wait_for_timeout(6000)
    r = page.evaluate(JS)
    print(json.dumps(r, indent=1)[:3500])
    browser.close()
