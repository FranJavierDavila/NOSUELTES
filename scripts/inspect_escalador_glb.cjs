// Radiografía de public/models/escalador.glb: nodos, skins, animaciones,
// escalas locales y bind matrices — para diagnosticar el esqueleto roto (T49).
const fs = require("fs");
const path = "/home/z/my-project/public/models/escalador.glb";
const buf = fs.readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));

const out = { meshes: (json.meshes || []).length, materials: (json.materials || []).length, images: (json.images || []).length, animations: (json.animations || []).length, skins: (json.skins || []).length, nodes: (json.nodes || []).length };
console.log("RESUMEN:", JSON.stringify(out));

// Escenas → raíces
console.log("\nRAÍCES:", JSON.stringify(json.scenes?.[0]?.nodes || []));

// Tabla de nodos: nombre, escala/traslación/rotación locales, mesh, skin
function nodeLine(i, depth) {
  const n = json.nodes[i];
  const flags = [];
  if (n.mesh !== undefined) flags.push(`mesh=${n.mesh}`);
  if (n.skin !== undefined) flags.push(`skin=${n.skin}`);
  if (n.scale && n.scale.some((s) => Math.abs(s - 1) > 1e-6)) flags.push(`SCALE=${JSON.stringify(n.scale)}`);
  if (n.matrix) flags.push(`MATRIX=${n.matrix.map((v) => +v.toFixed(4)).join(",")}`);
  const t = n.translation ? `t=[${n.translation.map((v) => +v.toFixed(3)).join(",")}]` : "";
  const r = n.rotation ? `r=[${n.rotation.map((v) => +v.toFixed(3)).join(",")}]` : "";
  const s = n.scale ? `s=[${n.scale.map((v) => +v.toFixed(3)).join(",")}]` : "";
  console.log(`${"  ".repeat(depth)}#${i} ${n.name || "<sin nombre>"} ${flags.join(" ")} ${t} ${r} ${s}`);
  for (const c of n.children || []) nodeLine(c, depth + 1);
}
for (const r of json.scenes?.[0]?.nodes || []) nodeLine(r, 0);

// Skins: joint count + joint índices → nombres
console.log("\nSKINS:");
for (const [si, sk] of (json.skins || []).entries()) {
  const names = (sk.joints || []).map((j) => json.nodes[j].name);
  console.log(`  skin[${si}] "${sk.name || ""}" joints=${names.length}`);
  console.log(`    ${names.join(", ")}`);
}

// Animaciones
console.log("\nANIMACIONES:");
for (const [ai, an] of (json.animations || []).entries()) {
  const targets = new Set();
  for (const ch of an.channels || []) if (ch.target?.node !== undefined) targets.add(json.nodes[ch.target.node].name);
  console.log(`  anim[${ai}] "${an.name || ""}" canales=${(an.channels || []).length} nodos afectados=${targets.size}: ${[...targets].slice(0, 8).join(", ")}${targets.size > 8 ? "…" : ""}`);
}

// Mallas: primitivas y pesos de skin
console.log("\nMALLAS:");
for (const [mi, m] of (json.meshes || []).entries()) {
  const users = json.nodes.map((n, ni) => (n.mesh === mi ? json.nodes[ni].name : null)).filter(Boolean);
  const prims = m.primitives.map((p) => `attrs=${Object.keys(p.attributes || {}).join("|")}`).join(" ; ");
  console.log(`  mesh[${mi}] usadoPor=${users.join(",")} prims=${m.primitives.length} ${prims}`);
}
