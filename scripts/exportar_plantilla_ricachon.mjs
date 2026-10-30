// T58-C — EXPORTADOR DE LA PLANTILLA DEL RICACHÓN POR PIEZAS (Node, headless).
//
// Mismo procedimiento que el escalador (scripts/exportar_plantilla_escalador.mjs,
// T53): el usuario esculpió sherpa.glb sobre esa plantilla y FUNCIONÓ (T57), así
// que el ricachón recibe el mismo trato para su modelo personalizado (T59).
//
//   ricachon_plantilla_piezas.glb — piezas con el ORIGEN DEL OBJETO EN SU
//   ARTICULACIÓN (pivote), jerarquía PLANA, + esferas de junta de referencia.
//
// Medidas de richMan.ts (la física es la verdad): 11 partículas RM.* con
// offsets relativos a la PELVIS; palos = longitudes sagradas:
//   cuello 0,27 · torso 0,35 · brazo 0,24+0,22 · pierna 0,36+0,34
// Radios del visual (scene.ts spawnRichMan): torso 0,16 · cuello 0,05 ·
// brazo 0,05/0,04 · muslo 0,07 · pantorrilla 0,055 · cabeza esfera d 0,26.
// Ejecutar: node scripts/exportar_plantilla_ricachon.mjs
import { writeFileSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Quaternion, MeshBuilder, StandardMaterial, Color3, Mesh } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0/glTFSerializer.js";

const OUT = "/home/z/my-project/download";
const MODELS = "/home/z/my-project/public/models";
mkdirSync(OUT, { recursive: true });

const volcar = async (glb, name, path) => {
  const v = glb.files[`${name}.glb`];
  const buf = v instanceof Blob ? Buffer.from(await v.arrayBuffer()) : Buffer.from(v);
  writeFileSync(path, buf);
  return buf.length;
};

const engine = new NullEngine();
const scene = new Scene(engine);
scene.useRightHandedSystem = true; // glTF es right-handed: exportar sin volteo

// ---------- pose canónica (metros, Y arriba, mira a +Z; L en x negativo) ----------
// La PELVIS en (0, 0.9, 0): con las longitudes de los palos los pies quedan a
// y = 0.9 − 0.68 = 0.22 (postura patizamba de ricachón: rodillas juntas, punta
// hacia fuera — esculpe encima sin miedo, SOLO LOS PIVOTES son sagrados).
const V = (x, y, z) => new Vector3(x, y, z);
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return V(v.x / l, v.y / l, v.z / l); };
const mid = (a, b) => V((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

// Partículas RM.* (offsets de richMan.build) relativas a la pelvis:
const pelvis = V(0, 0.9, 0);
const P = { // absolutas = pelvis + offset del juego
  pelvis, chest: V(0, 1.25, 0), head: V(0, 1.52, 0),
  elbowL: V(-0.2, 1.15, 0), elbowR: V(0.2, 1.15, 0),
  handL: V(-0.3, 0.95, 0), handR: V(0.3, 0.95, 0),
  kneeL: V(-0.1, 0.55, 0), kneeR: V(0.1, 0.55, 0),
  footL: V(-0.12, 0.22, 0), footR: V(0.12, 0.22, 0),
};

// ---------- materiales (los del juego) ----------
const clothes = new StandardMaterial("ropa", scene); clothes.diffuseColor = Color3.FromHexString("#7c4dbd");
const body = new StandardMaterial("piel", scene); body.diffuseColor = Color3.FromHexString("#c9a86a");
const dark = new StandardMaterial("oscuro", scene); dark.diffuseColor = Color3.FromHexString("#241d2e");
const junta = new StandardMaterial("junta_ref", scene); junta.diffuseColor = Color3.FromHexString("#8a8a8a");
const snackM = new StandardMaterial("propina", scene); snackM.diffuseColor = Color3.FromHexString("#d9a066");

const up = V(0, 1, 0);

/** Cápsula EXACTA del juego (height = hueso + radius, tess 8, caps 4). */
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

/** Pieza con el ORIGEN DEL OBJETO EN LA ARTICULACIÓN a (lección T53: hornear
 *  SOLO rotación + offset local; el nodo glTF queda con translation = pivote). */
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

/** Esfera con origen DESPLAZADO a un pivote (la geometría queda relativa). */
function spherePiece(name, pivot, d, material, geomOffset = V(0, 0, 0)) {
  const m = MeshBuilder.CreateSphere(name, { diameter: d, segments: 10 }, scene);
  m.position.set(geomOffset.x, geomOffset.y, geomOffset.z);
  m.bakeCurrentTransformIntoVertices();
  m.rotationQuaternion = null;
  m.position.set(pivot.x, pivot.y, pivot.z);
  m.material = material;
  return m;
}

/** Caja con origen en un pivote (geometría relativa al pivote). */
function boxPiece(name, pivot, size, material, geomOffset = V(0, 0, 0)) {
  const m = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
  m.position.set(geomOffset.x, geomOffset.y, geomOffset.z);
  m.bakeCurrentTransformIntoVertices();
  m.rotationQuaternion = null;
  m.position.set(pivot.x, pivot.y, pivot.z);
  m.material = material;
  return m;
}

/** Cilindro con origen en un pivote (geometría relativa al pivote). */
function cylPiece(name, pivot, dTop, dBottom, h, material, geomOffset = V(0, 0, 0)) {
  const m = MeshBuilder.CreateCylinder(name, { diameterTop: dTop, diameterBottom: dBottom, height: h, tessellation: 10 }, scene);
  m.position.set(geomOffset.x, geomOffset.y, geomOffset.z);
  m.bakeCurrentTransformIntoVertices();
  m.rotationQuaternion = null;
  m.position.set(pivot.x, pivot.y, pivot.z);
  m.material = material;
  return m;
}

// ---------- LAS PIEZAS (nombres rico_*; pivote = articulación/partícula) ----------
// Torso: cápsula pelvis→pecho (el juego la dibuja r 0,16) — LA PANZA se
// esculpe aquí (el torso físico es la pareja de palos pelvis↔pecho).
pieceFromJoint("rico_torso", P.pelvis, P.chest, 0.16, clothes);
// Cabeza: esfera d 0,26 con pivote EN LA PARTÍCULA head (el juego la centra ahí)
spherePiece("rico_cabeza", P.head, 0.26, body);
// Brazos: pivote en el PECHO (el juego usa UNA partícula chest para ambos hombros)
pieceFromJoint("rico_brazo_sup_izq", P.chest, P.elbowL, 0.05, clothes);
pieceFromJoint("rico_antebrazo_izq", P.elbowL, P.handL, 0.04, body); // mano en mitón
pieceFromJoint("rico_brazo_sup_der", P.chest, P.elbowR, 0.05, clothes);
pieceFromJoint("rico_antebrazo_der", P.elbowR, P.handR, 0.04, body);
// Piernas: MUSLOS con pivote EN LA PELVIS (ambos; el juego usa UNA partícula)
pieceFromJoint("rico_muslo_izq", P.pelvis, P.kneeL, 0.07, clothes);
pieceFromJoint("rico_muslo_der", P.pelvis, P.kneeR, 0.07, clothes);
pieceFromJoint("rico_pantorrilla_izq", P.kneeL, P.footL, 0.055, body); // pie dentro
pieceFromJoint("rico_pantorrilla_der", P.kneeR, P.footR, 0.055, body);
// SOMBRERO (copa + ala): pivote en la CORONA de la cabeza (head + 0,13)
const corona = V(P.head.x, P.head.y + 0.13, P.head.z);
cylPiece("rico_sombrero", corona, 0.11, 0.13, 0.1, dark, V(0, 0.05, 0));
cylPiece("rico_ala_sombrero", corona, 0.24, 0.24, 0.016, dark, V(0, 0.008, 0));
// GAFAS: pivote en el CENTRO de la cabeza, geometría adelantada (+z, mira +z)
boxPiece("rico_gafas", P.head, [0.2, 0.045, 0.028], dark, V(0, 0.02, 0.115));
// PROPS DE GESTO (aparecen al comer/brindar/leer/llamar): pivote en la MANO
boxPiece("rico_bocadillo", P.handL, [0.11, 0.05, 0.055], snackM, V(0, 0.03, 0.04));
cylPiece("rico_copita", P.handR, 0.055, 0.04, 0.085, snackM, V(0, 0.045, 0.04));
boxPiece("rico_libro", P.handL, [0.16, 0.02, 0.22], snackM, V(0, 0.02, 0.06));
boxPiece("rico_telefono", P.handR, [0.06, 0.11, 0.015], dark, V(0, 0.06, 0.02));
// esferas de JUNTA (referencia para tapar uniones; BORRAR antes de exportar)
spherePiece("junta_pelvis", P.pelvis, 0.4, junta);
spherePiece("junta_pecho", P.chest, 0.36, junta);
spherePiece("junta_cabeza", P.head, 0.3, junta);
spherePiece("junta_codo_izq", P.elbowL, 0.13, junta);
spherePiece("junta_codo_der", P.elbowR, 0.13, junta);
spherePiece("junta_mano_izq", P.handL, 0.12, junta);
spherePiece("junta_mano_der", P.handR, 0.12, junta);
spherePiece("junta_rodilla_izq", P.kneeL, 0.17, junta);
spherePiece("junta_rodilla_der", P.kneeR, 0.17, junta);
spherePiece("junta_pie_izq", P.footL, 0.15, junta);
spherePiece("junta_pie_der", P.footR, 0.15, junta);

const bytes = await GLTF2Export.GLBAsync(scene, "ricachon_plantilla_piezas")
  .then((g) => volcar(g, "ricachon_plantilla_piezas", `${OUT}/ricachon_plantilla_piezas.glb`));
copyFileSync(`${OUT}/ricachon_plantilla_piezas.glb`, `${MODELS}/ricachon_plantilla_piezas.glb`);

// ---------- verificación: reler el GLB (los nombres viven en NODOS) ----------
const buf = readFileSync(`${OUT}/ricachon_plantilla_piezas.glb`);
const jsLen = buf.readUInt32LE(12);
const js = JSON.parse(buf.slice(20, 20 + jsLen).toString("utf8"));
const names = (js.nodes ?? []).map((n) => n.name ?? "(sin nombre)");
console.log(`ricachon_plantilla_piezas.glb · ${bytes} B · ${names.length} nodos:\n  ${names.join(", ")}`);
const piezas = names.filter((n) => n.startsWith("rico_"));
if (piezas.length < 15) throw new Error(`faltan piezas (${piezas.length})`);
console.log("OK — plantilla del ricachón exportada y copiada a public/models/");
