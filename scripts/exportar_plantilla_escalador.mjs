// T53 — EXPORTADOR DE LA PLANTILLA DEL ESCALADOR PROCEDURAL (Node, headless).
//
// El escalador del juego son cápsulas de Babylon creadas en
// SherpaScene.spawnSherpa() y posadas CADA FRAME sobre las 15 partículas de
// física (sherpaRig.ts). Este script reproduce ESO EXACTO — mismas llamadas a
// MeshBuilder.CreateCapsule (radius, height = hueso + radius, tessellation 8,
// capSubdivisions 4), misma orientación (quaternion Up→dirección del hueso) —
// en una pose canónica de pie (brazos caídos, A-pose) y exporta GLB:
//
//   1) escalador_procedural_referencia.glb — RÉPLICA EXACTA: las 15 cápsulas
//      + cabeza (esfera d 0,24) + mochila (caja 0,30×0,38×0,14), nombres
//      idénticos al juego (torso, hipL, uarmL…), colores del jugador 0.
//   2) escalador_plantilla_piezas.glb — PLANTILLA POR PIEZAS (Opción B):
//      10 piezas con el ORIGEN del objeto EN SU ARTICULACIÓN (pivote),
//      jerarquía PLANA (sin parentar), + conectores auxiliares + esferas de
//      junta de referencia. En Blender cada pieza ya rota sobre su articulación.
//
// Medidas óseas de sherpaRig.ts: brazo 0,46+0,42 · pierna 0,50+0,47 ·
// hombros ±0,19 · caderas ±0,13 · pecho +0,32 · cabeza +0,62 (desde cintura).
// Ejecutar: node scripts/exportar_plantilla_escalador.mjs
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Quaternion, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";

const OUT = "/home/z/my-project/download";
mkdirSync(OUT, { recursive: true });

/** GLTFData.files guarda Blob (GLB) — volcarlo a Buffer en Node. */
const volcar = async (glb, name, path) => {
  const v = glb.files[`${name}.glb`];
  const buf = v instanceof Blob ? Buffer.from(await v.arrayBuffer()) : Buffer.from(v);
  writeFileSync(path, buf);
  return buf.length;
};

const engine = new NullEngine();
const scene = new Scene(engine);
scene.useRightHandedSystem = true; // glTF es right-handed: exportar sin volteo

// ---------- pose canónica (metros, Y arriba, el personaje mira a +Z) ----------
const V = (x, y, z) => new Vector3(x, y, z);
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return V(v.x / l, v.y / l, v.z / l); };
const addS = (a, d, len) => V(a.x + d.x * len, a.y + d.y * len, a.z + d.z * len); // a + dir*len EXACTO

const pelvisC = V(0, 0.98, 0);
const chest = V(0, 1.30, 0.02);
const head = V(0, 1.60, 0.04);
const shL = V(-0.19, 1.26, 0.02), shR = V(0.19, 1.26, 0.02);
const hipL = V(-0.13, 0.96, 0), hipR = V(0.13, 0.96, 0);
// brazos caídos (codos atrás-afuera, manos algo adelantadas), longitudes EXACTAS
const elbowL = addS(shL, norm(V(-0.11, -1, -0.06)), 0.46);
const handL = addS(elbowL, norm(V(-0.05, -1, 0.10)), 0.42);
const elbowR = addS(shR, norm(V(0.11, -1, -0.06)), 0.46);
const handR = addS(elbowR, norm(V(0.05, -1, 0.10)), 0.42);
// piernas rectas (rodilla algo adelante, como el polo IK del juego z+)
const kneeL = addS(hipL, norm(V(0.015, -1, 0.10)), 0.50);
const footL = addS(kneeL, norm(V(0, -1, -0.10)), 0.47);
const kneeR = addS(hipR, norm(V(-0.015, -1, 0.10)), 0.50);
const footR = addS(kneeR, norm(V(0, -1, -0.10)), 0.47);

const J = { pelvisC, chest, head, shL, shR, hipL, hipR, elbowL, elbowR, handL, handR, kneeL, kneeR, footL, footR };

// ---------- materiales (los del juego, jugador 0) ----------
const bodyMat = new StandardMaterial("body0", scene);
bodyMat.diffuseColor = Color3.FromHexString("#d97b2f");
const strapMat = new StandardMaterial("strap0", scene);
strapMat.diffuseColor = Color3.FromHexString("#e8542f");
const juntaMat = new StandardMaterial("junta", scene);
juntaMat.diffuseColor = Color3.FromHexString("#8a8a8a");

// ---------- construcción (misma receta que spawnSherpa/orientCapsule) ----------
const up = V(0, 1, 0);
const mid = (a, b) => V((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Cápsula EXACTA del juego: height = hueso + radius, tess 8, caps 4. */
function capsule(name, a, b, radius, material) {
  const rest = dist(a, b);
  const m = MeshBuilder.CreateCapsule(name, { radius, height: rest + radius, tessellation: 8, capSubdivisions: 4 }, scene);
  const dir = norm(V(b.x - a.x, b.y - a.y, b.z - a.z));
  if (!m.rotationQuaternion) m.rotationQuaternion = new Quaternion();
  Quaternion.FromUnitVectorsToRef(up, dir, m.rotationQuaternion);
  const c = mid(a, b);
  m.position.set(c.x, c.y, c.z);
  m.material = material;
  return m;
}

/** Pieza con el ORIGEN DEL OBJETO EN LA ARTICULACIÓN a (pivote). Se crea la
 *  cápsula centrada en el origen, se hornea ROTACIÓN + offset local (punto
 *  medio − articulación) → los vértices quedan RELATIVOS AL PIVOTE; el nodo
 *  glTF queda con translation = a. En Blender: origen = articulación. */
function pieceFromJoint(name, a, b, radius, material) {
  const rest = dist(a, b);
  const m = MeshBuilder.CreateCapsule(name, { radius, height: rest + radius, tessellation: 8, capSubdivisions: 4 }, scene);
  const dir = norm(V(b.x - a.x, b.y - a.y, b.z - a.z));
  m.rotationQuaternion = new Quaternion();
  Quaternion.FromUnitVectorsToRef(up, dir, m.rotationQuaternion);
  const c = mid(a, b);
  m.position.set(c.x - a.x, c.y - a.y, c.z - a.z); // offset local al pivote
  m.bakeCurrentTransformIntoVertices();            // hornea rotación + offset
  m.rotationQuaternion = null;
  m.position.set(a.x, a.y, a.z);                   // el nodo ES el pivote
  m.material = material;
  return m;
}

const sphereAt = (name, c, d, material) => {
  const m = MeshBuilder.CreateSphere(name, { diameter: d, segments: 10 }, scene);
  m.position.set(c.x, c.y, c.z);
  m.material = material;
  return m;
};

// ---------- 1) RÉPLICA EXACTA (nombres del juego, sin p0_) ----------
const bones = [
  ["torso", chest, pelvisC, 0.15, bodyMat],
  ["hipL", pelvisC, hipL, 0.06, bodyMat],
  ["hipR", pelvisC, hipR, 0.06, bodyMat],
  ["shL", chest, shL, 0.055, strapMat],
  ["shR", chest, shR, 0.055, strapMat],
  ["uarmL", shL, elbowL, 0.05, bodyMat],
  ["farmL", elbowL, handL, 0.045, bodyMat],
  ["uarmR", shR, elbowR, 0.05, bodyMat],
  ["farmR", elbowR, handR, 0.045, bodyMat],
  ["thighL", hipL, kneeL, 0.065, bodyMat],
  ["shinL", kneeL, footL, 0.055, bodyMat],
  ["thighR", hipR, kneeR, 0.065, bodyMat],
  ["shinR", kneeR, footR, 0.055, bodyMat],
];
for (const [n, a, b, r, mat] of bones) capsule(n, a, b, r, mat);
sphereAt("head", V(head.x, head.y + 0.02, head.z), 0.24, bodyMat);
const pack = MeshBuilder.CreateBox("pack", { width: 0.3, height: 0.38, depth: 0.14 }, scene);
pack.material = strapMat;
const pc = mid(chest, pelvisC);
pack.position.set(pc.x, pc.y, pc.z - 0.13);
pack.rotation.x = Math.atan2(pelvisC.x - chest.x, pelvisC.y - chest.y); // fórmula del juego

const nA = await GLTF2Export.GLBAsync(scene, "escalador_procedural_referencia").then((g) => volcar(g, "escalador_procedural_referencia", `${OUT}/escalador_procedural_referencia.glb`));

// ---------- 2) PLANTILLA POR PIEZAS (Opción B: pivote EN la articulación) ----------
for (const m of scene.meshes.slice()) m.dispose();
[bodyMat, strapMat, juntaMat].forEach((m) => m.dispose());

const body = new StandardMaterial("cuerpo", scene); body.diffuseColor = Color3.FromHexString("#d97b2f");
const strap = new StandardMaterial("correa", scene); strap.diffuseColor = Color3.FromHexString("#e8542f");
const junta = new StandardMaterial("junta_ref", scene); junta.diffuseColor = Color3.FromHexString("#8a8a8a");

// LAS 10 PIEZAS — origen del objeto = articulación proximal (pivote).
pieceFromJoint("pieza_torso", pelvisC, chest, 0.15, body);
sphereAt("pieza_cabeza", V(0, 0, 0), 0.24, body).position.set(head.x, head.y, head.z); // esfera con origen en el cuello
{
  // desplazar la GEOMETRÍA +0,02 arriba (centro visual del juego) hornéandola:
  const h = scene.meshes.find((x) => x.name === "pieza_cabeza");
  h.position.set(0, 0.02, 0);
  h.bakeCurrentTransformIntoVertices();
  h.position.set(head.x, head.y, head.z);
}
pieceFromJoint("pieza_brazo_sup_izq", shL, elbowL, 0.05, body);
pieceFromJoint("pieza_antebrazo_izq", elbowL, handL, 0.045, body); // mano en mitón dentro
pieceFromJoint("pieza_brazo_sup_der", shR, elbowR, 0.05, body);
pieceFromJoint("pieza_antebrazo_der", elbowR, handR, 0.045, body);
pieceFromJoint("pieza_muslo_izq", hipL, kneeL, 0.065, body);
pieceFromJoint("pieza_pantorrilla_izq", kneeL, footL, 0.055, body); // pie en bota dentro
pieceFromJoint("pieza_muslo_der", hipR, kneeR, 0.065, body);
pieceFromJoint("pieza_pantorrilla_der", kneeR, footR, 0.055, body);
// conectores auxiliares (los dibuja el juego)
pieceFromJoint("conector_cadera_izq", pelvisC, hipL, 0.06, body);
pieceFromJoint("conector_cadera_der", pelvisC, hipR, 0.06, body);
pieceFromJoint("tirante_izq", chest, shL, 0.055, strap);
pieceFromJoint("tirante_der", chest, shR, 0.055, strap);
const pack2 = MeshBuilder.CreateBox("mochila", { width: 0.3, height: 0.38, depth: 0.14 }, scene);
pack2.material = strap;
pack2.position.set(pc.x, pc.y, pc.z - 0.13);
pack2.rotation.x = Math.PI;
// esferas de JUNTA (referencia para tapar uniones; BORRAR antes de exportar)
sphereAt("junta_pelvis", pelvisC, 0.26, junta);
sphereAt("junta_pecho", chest, 0.22, junta);
sphereAt("junta_cuello", head, 0.11, junta);
sphereAt("junta_hombro_izq", shL, 0.124, junta);
sphereAt("junta_hombro_der", shR, 0.124, junta);
sphereAt("junta_codo_izq", elbowL, 0.104, junta);
sphereAt("junta_codo_der", elbowR, 0.104, junta);
sphereAt("junta_cadera_izq", hipL, 0.15, junta);
sphereAt("junta_cadera_der", hipR, 0.15, junta);
sphereAt("junta_rodilla_izq", kneeL, 0.136, junta);
sphereAt("junta_rodilla_der", kneeR, 0.136, junta);

const nB = await GLTF2Export.GLBAsync(scene, "escalador_plantilla_piezas").then((g) => volcar(g, "escalador_plantilla_piezas", `${OUT}/escalador_plantilla_piezas.glb`));

// ---------- verificación: reler los GLB y resumir (los nombres viven en NODOS) ----------
function resumen(path, bytes) {
  const buf = readFileSync(path);
  const jsLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.slice(20, 20 + jsLen).toString("utf8"));
  const nodes = js.nodes ?? [];
  const names = nodes.map((n) => n.name ?? "(sin nombre)");
  console.log(`${path.split("/").pop()} · ${bytes} B · ${nodes.length} nodos:\n  ${names.join(", ")}`);
  return names;
}
const a = resumen(`${OUT}/escalador_procedural_referencia.glb`, nA);
const b = resumen(`${OUT}/escalador_plantilla_piezas.glb`, nB);
if (a.length < 15) throw new Error("referencia incompleta");
if (!b.some((n) => n.startsWith("pieza_"))) throw new Error("faltan piezas");
console.log("OK — plantillas exportadas");
