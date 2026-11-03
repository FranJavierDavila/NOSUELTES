// T93/T95 — inspección GLB: lista TODOS los nodos (nombre, traslación, mesh,
// bounds del accessor) de Base.glb y rico.glb para decidir (a) dónde colocar la
// caseta para que entre en plano y (b) qué malla sobresale bajo el ricachón.
import { readFileSync } from "node:fs";

function inspect(path, { maxNodes = Infinity } = {}) {
  const buf = readFileSync(path);
  const magic = buf.subarray(0, 4).toString("ascii");
  const version = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  console.log(`\n================ ${path} ================`);
  console.log(`magic=${magic} version=${version} json=${jsonLen}B generator=${gltf.asset?.generator ?? "?"}`);
  const acc = gltf.accessors ?? [];
  const bmin = (m) => {
    if (m == null) return null;
    const a = acc[m]?.min, b = acc[m]?.max;
    if (!a || !b) return null;
    return { min: a.map((v) => +v.toFixed(3)), max: b.map((v) => +v.toFixed(3)) };
  };
  const nodes = gltf.nodes ?? [];
  console.log(`nodos=${nodes.length} mallas=${(gltf.meshes ?? []).length} imágenes=${(gltf.images ?? []).length}`);
  nodes.forEach((n, i) => {
    if (i >= maxNodes) return;
    const t = n.matrix ? n.matrix.slice(12, 15).map((v) => +v.toFixed(3)) : (n.translation ?? [0, 0, 0]).map((v) => +v.toFixed(3));
    let info = `node[${i}] "${n.name ?? ""}" t=[${t}]`;
    if (n.mesh != null) {
      const mesh = gltf.meshes[n.mesh];
      const prims = mesh.primitives ?? [];
      const bounds = prims.map((p) => bmin(p.attributes?.POSITION));
      info += ` mesh="${mesh.name ?? n.mesh}" prims=${prims.length}`;
      if (bounds.length === 1 && bounds[0]) {
        const { min, max } = bounds[0];
        info += ` size=[${min.map((v, k) => (max[k] - v).toFixed(2))}] min=[${min}] max=[${max}]`;
      }
      if (n.skin != null) info += ` skin=${n.skin}`;
    }
    if (n.children?.length) info += ` hijos=[${n.children.join(",")}]`;
    console.log(info);
  });
  // escena raíz
  console.log("escenas:", JSON.stringify(gltf.scenes));
  // materiales (nombres)
  const mats = (gltf.materials ?? []).map((m) => m.name).filter(Boolean);
  if (mats.length) console.log(`materiales(${mats.length}):`, mats.slice(0, 24).join(", "), mats.length > 24 ? "…" : "");
}

inspect(process.argv[2] ?? "upload/Base.glb", { maxNodes: process.argv[4] ? +process.argv[4] : Infinity });
if (process.argv[3]) inspect(process.argv[3], { maxNodes: 200 });
