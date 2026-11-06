// Repro numérico del verlet de la cuerda (ropeStep de paredNivel.ts) y del fix.
// Corre: node /home/z/my-project/scripts/repro-cuerda-t120.mjs
const g = 9.81, damp = 0.975, totalLen = 5.5;

const sim = (pasos, nSeg, passes, dampLimite) => {
  // extremos: cinturas de los dos sherpas en la salida
  const A = { x: -1.3, y: 2.18, z: 0.01 }, B = { x: 1.3, y: 2.18, z: 0.01 };
  const n = nSeg + 1;
  const nodes = [];
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 0.35, z: (A.z + B.z) / 2 };
  for (let i = 0; i <= nSeg; i++) {
    const t = i / nSeg;
    const src = t < 0.5 ? A : mid, dst = t < 0.5 ? mid : B;
    const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const sag = Math.sin(u * Math.PI) * 0.22;
    const pos = { x: src.x + (dst.x - src.x) * u, y: src.y + (dst.y - src.y) * u - sag, z: src.z + (dst.z - src.z) * u - 0.04 };
    nodes.push({ pos: { ...pos }, prev: { ...pos } });
  }
  const segLen = totalLen / nSeg;
  const dt = 1 / 60;
  let maxMod = 0;
  for (let f = 0; f < 600; f++) {
    for (let i = 1; i < n - 1; i++) {
      const nd = nodes[i];
      let vx = (nd.pos.x - nd.prev.x) * damp, vy = (nd.pos.y - nd.prev.y) * damp, vz = (nd.pos.z - nd.prev.z) * damp;
      // FIX opcional: limitar la velocidad por nodo (estabilidad PBD clásica)
      if (dampLimite > 0) {
        const v = Math.hypot(vx, vy, vz);
        if (v > dampLimite) { vx *= dampLimite / v; vy *= dampLimite / v; vz *= dampLimite / v; }
      }
      nd.prev = { ...nd.pos };
      nd.pos = { x: nd.pos.x + vx, y: nd.pos.y + vy - g * dt * dt, z: nd.pos.z + vz };
    }
    nodes[0].pos = { ...A }; nodes[n - 1].pos = { ...B };
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < n - 1; i++) {
        const p1 = nodes[i].pos, p2 = nodes[i + 1].pos;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) || 1e-6;
        const diff = (dist - segLen) / dist;
        const fx = (p2.x - p1.x) * diff * 0.5, fy = (p2.y - p1.y) * diff * 0.5, fz = (p2.z - p1.z) * diff * 0.5;
        if (i !== 0) { p1.x += fx; p1.y += fy; p1.z += fz; }
        if (i + 1 !== n - 1) { p2.x -= fx; p2.y -= fy; p2.z -= fz; }
      }
      nodes[0].pos = { ...A }; nodes[n - 1].pos = { ...B };
    }
    if (f > 500) for (const nd of nodes) maxMod = Math.max(maxMod, Math.hypot(nd.pos.x, nd.pos.y, nd.pos.z));
  }
  return maxMod;
};

console.log("ORIGINAL (2 pasadas, sin límite):", sim(600, 7, 2, 0).toExponential(2));
console.log("FIX 4 pasadas + vMax 0,05:", sim(600, 7, 4, 0.05).toExponential(2));
console.log("FIX 4 pasadas + vMax 0,03:", sim(600, 7, 4, 0.03).toExponential(2));
console.log("FIX 2 pasadas + vMax 0,05:", sim(600, 7, 2, 0.05).toExponential(2));
