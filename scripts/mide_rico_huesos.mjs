// T84 — mido los PIVOTES de las piezas de public/models/rico.glb (chunk JSON
// del GLB) para derivar las LONGITUDES DE HUESO reales del esqueleto del
// ricachón: la distancia entre pivotes consecutivos (brazo_sup→antebrazo,
// muslo→pantorrilla, torso→cabeza) ES la longitud que el mesh cubre, y el
// rig articulado debe usar EXACTAMENTE esas (si no, las piezas quedan cortas
// o enterradas unas dentro de otras = efecto marioneta).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const buf = readFileSync(join(process.cwd(), "public/models/rico.glb"));
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

/** @type {Map<number, string>} */
const nameOf = new Map();

const PIECES = [
  "pieza_torso", "pieza_cabeza",
  "pieza_brazo_sup_izq", "pieza_antebrazo_izq",
  "pieza_brazo_sup_der", "pieza_antebrazo_der",
  "pieza_muslo_izq", "pieza_pantorrilla_izq",
  "pieza_muslo_der", "pieza_pantorrilla_der",
];

/** @type {Map<string, number[]>} */
const pivots = new Map();
for (let i = 0; i < gltf.nodes.length; i++) {
  const n = gltf.nodes[i];
  const name = n.name ?? "";
  if (!PIECES.includes(name)) continue;
  // TRS glTF: T·R·S — si hay matrix, descompongo; si hay translation, directo
  if (n.matrix) {
    const m = n.matrix; // column-major
    pivots.set(name, [m[12], m[13], m[14]]);
  } else {
    pivots.set(name, n.translation ?? [0, 0, 0]);
  }
  console.log(name, "translation=", pivots.get(name), "rotation=", n.rotation, "scale=", n.scale, "mesh=", n.mesh);
}

const d3 = (a, b) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

for (const side of ["izq", "der"]) {
  const sup = pivots.get(`pieza_brazo_sup_${side}`);
  const ant = pivots.get(`pieza_antebrazo_${side}`);
  if (sup && ant) console.log(`upperArm (${side}) =`, d3(sup, ant).toFixed(4));
  const mus = pivots.get(`pieza_muslo_${side}`);
  const pan = pivots.get(`pieza_pantorrilla_${side}`);
  if (mus && pan) console.log(`thigh (${side}) =`, d3(mus, pan).toFixed(4));
}

const torso = pivots.get("pieza_torso");
const cabeza = pivots.get("pieza_cabeza");
if (torso && cabeza) console.log("torso→cabeza =", d3(torso, cabeza).toFixed(4));

// bboxes de los meshes (accesor POSITION min/max) en espacio de nodo, relativos
// al pivote: dónde TERMINA visualmente cada hueso (para antebrazo/pantorrilla,
// que no tienen pieza hija con pivote)
for (const name of PIECES) {
  const nodeIdx = gltf.nodes.findIndex((n) => n.name === name);
  if (nodeIdx < 0) continue;
  const meshIdx = gltf.nodes[nodeIdx].mesh;
  if (meshIdx == null) continue;
  const piv = pivots.get(name);
  if (!piv) continue;
  let far = 0;
  for (const prim of gltf.meshes[meshIdx].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION];
    const bv = gltf.bufferViews[acc.bufferView];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const bin = gltf.buffers[0];
    // blob del binario (chunk BIN: empieza tras el JSON)
    if (!globalThis.__bin) {
      const jsonLen2 = buf.readUInt32LE(12);
      const binLen = buf.readUInt32LE(20 + jsonLen2);
      globalThis.__bin = buf.subarray(40, 40 + binLen);
    }
    const f32 = new Float32Array(globalThis.__bin.buffer, globalThis.__bin.byteOffset + off, acc.count * 3);
    for (let v = 0; v < acc.count; v++) {
      const dx = f32[v * 3] - piv[0], dy = f32[v * 3 + 1] - piv[1], dz = f32[v * 3 + 2] - piv[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > far) far = d;
    }
  }
  console.log(name, "longitud hueso (vértice más lejano al pivote) =", far.toFixed(4));
}
