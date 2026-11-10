// T98 — SUELO ALPINO INTEGRADO ("todo tenga una misma línea estética... zona
// alta de montaña con el suelo nevado y zona rocosa"). Módulo PURO (sin
// Babylon), igual que rockTint.ts/baseCamp.ts: dado un punto (x,z) del suelo
// devuelve el color RGBA por vértice que el PBR multiplica con su albedo casi
// blanco. Tres materiales de alta montaña, mezclados por ruido determinista:
//  · NIEVE — base dominante, con sombreado suave de ventisca (dips azulados).
//  · PIEDRA — parches expuestos de la FAMILIA DE LA CABAÑA (gris cálido de la
//    Base.glb): más probables al pie del muro (talud de derrubios) y en el
//    anillo rocoso que rodea el campamento, para que el GLB "asiente" en el
//    terreno en vez de estar pegado encima.
//  · HIELO — placas pálidas azuladas en las depresiones (deshielo diurno).
// La FRANJA DE CAÍDA (donde aterrizan los cuerpos) se mantiene LIMPIA: dentro
// de ella la piedra se reduce a la mitad para que el punto de aterrizaje siga
// siendo legible (misma razón por la que el pedriz la aplana, T56).
//
// La PALETA es la del campamento GLB (muestreada de la textura REAL de
// Base.glb en T101: dominante azul glaciar con rocas oscuras). T101 la
// ENFRIÓ (petición: «el suelo que recuerde mucho más al material de la
// base.glb, tonos azulados… haciéndolo extensible a todo el suelo»): nieve
// azulada, piedra gris-AZULada del macizo y placas de hielo glacial. El
// material PBR del suelo pasa a albedo casi blanco: el TONO lo portan estos
// colores por vértice (igual que la pared T55: textura/albedo neutro +
// vértice manda).

export interface GroundTintCtx {
  /** z de la cara del muro (wallFrontZ ≈ −0.3): el talud de piedra vive cerca. */
  wallZ: number;
  /** franja de caída a proteger (mitades con margen ya incluidas por el caller). */
  corridor: { halfX: number; zMin: number; zMax: number };
  /** campamento GLB: anillo rocoso alrededor (null = sin cabaña). */
  cabin: { x: number; z: number; r: number } | null;
}

export interface GroundTintCfg {
  enabled: boolean;
  /** cuánta piedra asoma (0 = todo nieve, 1 = campo de derrubios). */
  stoneCover: number;
  /** intensidad de las placas de hielo (0..1). */
  iceAmount: number;
  /** radio extra del anillo rocoso alrededor de la cabaña (m). */
  cabinRingM: number;
  /** semilla determinista. */
  seed: number;
}

export const GROUND_TINT_DEFAULTS: GroundTintCfg = {
  enabled: true,
  stoneCover: 0.42,
  iceAmount: 0.95, // T101: el glaciar azul de la base se nota más desde el aire
  cabinRingM: 1.7,
  seed: 90210,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

/** Datos crudos (wall_gen.relief.groundTint) → config defensiva. */
export function resolveGroundTintCfg(raw: unknown): GroundTintCfg {
  const r = (raw ?? null) as Partial<Record<keyof GroundTintCfg, unknown>> | null;
  const d = GROUND_TINT_DEFAULTS;
  return {
    enabled: r ? r.enabled !== false : d.enabled,
    stoneCover: num(r?.stoneCover, d.stoneCover, 0, 1),
    iceAmount: num(r?.iceAmount, d.iceAmount, 0, 1),
    cabinRingM: num(r?.cabinRingM, d.cabinRingM, 0, 6),
    seed: num(r?.seed, d.seed, 0, 0xffffffff),
  };
}

// --- ruido de valor determinista (misma familia que baseCamp.ts) ---

const hash2 = (ix: number, iy: number, seed: number): number => {
  let v = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) | 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  return ((v >>> 0) % 100000) / 100000; // 0..1
};

const vnoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

/** fbm 2 octavas (barato; parches orgánicos sin repetición visible). */
const fbm = (x: number, y: number, seed: number): number =>
  vnoise(x, y, seed) * 0.66 + vnoise(x * 2.17 + 5.3, y * 2.17 + 1.9, seed ^ 0x51ed) * 0.34;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** smoothstep que ACEPTA rangos decrecientes (a>b): 1 en v≤b, 0 en v≥a
 *  (misma variante de baseCamp.ts; la ingenua devuelve 1 siempre en rangos
 *  decrecientes y saturaba todos los refuerzos de piedra). */
const smooth = (a: number, b: number, v: number): number => {
  const den = b - a;
  const t = Math.abs(den) < 1e-9 ? (v >= b ? 1 : 0) : clamp01((v - a) / den);
  return t * t * (3 - 2 * t);
};

// --- paleta (multiplicadores sobre albedo casi blanco) ---
// T101 — FAMILIA AZUL DE LA BASE.GLB: textura muestreada (dominantes
// #6080e0/#6060e0 azules + rocas oscuras #402020). La saturación cruda del
// GLB se modula para el terreno (el PBR del juego la multiplica por el HDRI):
// nieve azulada, piedra gris-AZUL del macizo y hielo glacial bien presente.

const SNOW = [0.905, 0.93, 0.962] as const;
const STONE = [0.505, 0.532, 0.605] as const;
const ICE = [0.60, 0.745, 0.90] as const;

export const GROUND_KIND = { snow: 0, stone: 1, ice: 2 } as const;

/**
 * Color del suelo en UN punto (mismo criterio que la rejilla: usable suelto).
 * Devuelve [r, g, b, kind] con kind ∈ GROUND_KIND (material dominante).
 */
export function groundMaterialAt(x: number, z: number, ctx: GroundTintCfg & { ctx: GroundTintCtx }): [number, number, number, number] {
  const { stoneCover, iceAmount, cabinRingM, seed } = ctx;
  const c = ctx.ctx;
  // 1) PIEDRA: parches ~2 m, reforzados al pie del muro (talud) y alrededor de
  //    la cabaña (anillo rocoso del campamento). La franja de caída se queda
  //    más limpia (mitad de piedra) para leer el aterrizaje.
  const nStone = fbm(x * 0.52, z * 0.52, seed);
  const dCabin = c.cabin ? Math.hypot(x - c.cabin.x, z - c.cabin.z) : 99;
  const ring = c.cabin ? smooth(c.cabin.r + cabinRingM, c.cabin.r * 0.55, dCabin) : 0;
  const talus = smooth(c.wallZ + 4.6, c.wallZ - 0.4, z) * smooth(10.5, 6.5, Math.abs(x));
  const boost = 0.3 * ring + 0.24 * talus;
  const corridor = Math.abs(x) < c.corridor.halfX && z > c.corridor.zMin && z < c.corridor.zMax ? 1 : 0;
  const stoneA = 0.86 - stoneCover * 0.55; // calibrado sobre la distribución real del fbm
  const stone = smooth(stoneA, stoneA + 0.09, nStone + boost) * (1 - 0.55 * corridor);
  // 2) HIELO: placas en depresiones (ruido de sombreado bajo) donde no hay
  //    piedra. T101: umbral más bajo → el glaciar azul se ve desde el aire.
  const nShade = fbm(x * 0.33, z * 0.33, (seed ^ 0x5eed) >>> 0);
  const nIce = fbm(x * 0.78 + 13.1, z * 0.78 + 7.7, (seed ^ 0x1ce) >>> 0);
  const ice = smooth(0.71, 0.82, nIce) * smooth(0.62, 0.4, nShade) * (1 - stone) * iceAmount;
  // 3) composición: nieve sombreada por ventisca, piedra con macizo, hielo pálido.
  const shade = 0.86 + 0.14 * nShade;
  const mac = 1 + (vnoise(x * 0.21, z * 0.21, (seed ^ 0x77aa) >>> 0) - 0.5) * 0.2;
  const kind = stone > 0.5 ? GROUND_KIND.stone : ice > 0.35 ? GROUND_KIND.ice : GROUND_KIND.snow;
  const sr = SNOW[0] * shade;
  const sg = SNOW[1] * shade;
  const sb = SNOW[2] * shade;
  const tr = sr + (STONE[0] * mac - sr) * stone + (ICE[0] - sr) * ice;
  const tg = sg + (STONE[1] * mac - sg) * stone + (ICE[1] - sg) * ice;
  const tb = sb + (STONE[2] * mac - sb) * stone + (ICE[2] - sb) * ice;
  return [
    Math.min(1.25, Math.max(0.25, tr)),
    Math.min(1.25, Math.max(0.25, tg)),
    Math.min(1.25, Math.max(0.25, tb)),
    kind,
  ];
}

/**
 * Rejilla del suelo (posiciones mundo x,y,z) → colores RGBA por vértice.
 * Determinista: mismas entradas → mismo resultado (test unitario).
 */
export function computeGroundTint(positions: ArrayLike<number>, cfg: GroundTintCfg, ctx: GroundTintCtx): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n * 4);
  if (!cfg.enabled) {
    for (let i = 0; i < n * 4; i++) out[i] = 1;
    return out;
  }
  const full = { ...cfg, ctx };
  for (let v = 0; v < n; v++) {
    const [r, g, b] = groundMaterialAt(positions[v * 3]!, positions[v * 3 + 2]!, full);
    out[v * 4] = r;
    out[v * 4 + 1] = g;
    out[v * 4 + 2] = b;
    out[v * 4 + 3] = 1;
  }
  return out;
}

// ---------- decoro instanciado (la escena lo convierte en mallas) ----------

/**
 * Placas de hielo [x, z, escala, giroY]: depresiones con hielo, FUERA de la
 * franja de caída (resbalón visual sí, gameplay no: no tienen colisión) y del
 * radio de la cabaña.
 */
export function scatterIce(cfg: GroundTintCfg, ctx: GroundTintCtx): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const seed = (cfg.seed ^ 0x1ce5) >>> 0;
  for (let k = 0; k < 400 && out.length < 14; k++) {
    const r1 = vnoise(k * 1.31 + 0.7, k * 0.77 + 3.1, seed);
    const r2 = vnoise(k * 0.71 + 9.2, k * 1.17 + 5.5, seed ^ 0x2f);
    const r3 = vnoise(k * 1.9 + 2.2, k * 0.53 + 8.8, seed ^ 0x4a);
    const x = (r1 - 0.5) * 2 * 12.5;
    const z = (r2 - 0.5) * 2 * 8.5;
    if (Math.abs(x) < ctx.corridor.halfX + 0.7 && z > ctx.corridor.zMin - 0.4 && z < ctx.corridor.zMax + 0.7) continue;
    if (ctx.cabin && Math.hypot(x - ctx.cabin.x, z - ctx.cabin.z) < ctx.cabin.r + 0.4) continue;
    if (groundMaterialAt(x, z, { ...cfg, ctx })[3] === GROUND_KIND.stone) continue; // el hielo vive en la nieve
    out.push([x, z, 0.45 + r3 * 0.85, r3 * Math.PI * 2]);
  }
  return out;
}

/**
 * Tarrones de nieve [x, z, radio]: bordea el pie del muro y el anillo de la
 * cabaña (como la falda de nieve del GLB) + algunos salteados en el campo.
 */
export function scatterDrifts(cfg: GroundTintCfg, ctx: GroundTintCtx): [number, number, number][] {
  const out: [number, number, number][] = [];
  const seed = (cfg.seed ^ 0x0d1f7) >>> 0;
  // falda alrededor de la cabaña (fusiona la nieve del GLB con el terreno);
  // T98-closeups: tarros PEQUEÑOS — los grandes leían como "dados" blancos
  if (ctx.cabin) {
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2 + (vnoise(k * 3.1, 1.7, seed) - 0.5) * 0.6;
      const rr = ctx.cabin.r * (0.78 + vnoise(k * 1.3, 5.9, seed ^ 0x11) * 0.3);
      const x = ctx.cabin.x + Math.cos(ang) * rr;
      const z = ctx.cabin.z + Math.sin(ang) * rr * 0.8;
      if (Math.abs(x) < ctx.corridor.halfX && z > ctx.corridor.zMin && z < ctx.corridor.zMax) continue;
      out.push([x, z, 0.28 + vnoise(k * 2.2, 9.4, seed ^ 0x22) * 0.32]);
    }
  }
  // pie del muro: cordón de ventisca al abrigo del talud
  for (let k = 0; k < 5; k++) {
    const x = -9.5 + k * 4.7 + (vnoise(k * 4.4, 2.5, seed ^ 0x33) - 0.5) * 2.4;
    if (Math.abs(x) < ctx.corridor.halfX - 0.6) continue;
    out.push([x, ctx.wallZ - 0.9 - vnoise(k * 1.8, 6.1, seed ^ 0x44) * 0.7, 0.42 + vnoise(k * 2.9, 4.2, seed ^ 0x55) * 0.4]);
  }
  // campo abierto: unos pocos al azar determinista
  for (let k = 0; k < 140 && out.length < 14; k++) {
    const r1 = vnoise(k * 1.11 + 4.4, k * 0.63 + 1.2, seed ^ 0x66);
    const r2 = vnoise(k * 0.87 + 7.7, k * 1.41 + 8.3, seed ^ 0x77);
    const x = (r1 - 0.5) * 2 * 12.5;
    const z = (r2 - 0.5) * 2 * 8.5;
    if (Math.abs(x) < ctx.corridor.halfX + 0.6 && z > ctx.corridor.zMin - 0.3 && z < ctx.corridor.zMax + 0.6) continue;
    if (ctx.cabin && Math.hypot(x - ctx.cabin.x, z - ctx.cabin.z) < ctx.cabin.r + 0.9) continue;
    out.push([x, z, 0.34 + vnoise(k * 2.6, 3.3, seed ^ 0x88) * 0.5]);
  }
  return out;
}

/**
 * Anillo de BLOQUES alrededor de la cabaña [x, z, escala]: rocas de la familia
 * de la Base.glb que hacen que el campamento "asiente" en el terreno (ahora
 * mismo flota sobre el pedriz liso). Determinista, fuera de la franja de caída.
 */
export function cabinBoulderRing(cabinX: number, cabinZ: number, cabinR: number, ctx: GroundTintCtx): [number, number, number][] {
  const out: [number, number, number][] = [];
  const seed = (ctx.cabin ? Math.imul(Math.round(ctx.cabin.x * 8 + ctx.cabin.z * 4), 0x9e37) : 1234) >>> 0;
  for (let k = 0; k < 11; k++) {
    const ang = (k / 11) * Math.PI * 2 + (vnoise(k * 2.7, 3.3, seed) - 0.5) * 0.5;
    const rr = cabinR * (0.6 + vnoise(k * 1.9, 7.1, seed ^ 0x5a) * 0.38);
    const x = cabinX + Math.cos(ang) * rr;
    const z = cabinZ + Math.sin(ang) * rr * 0.82;
    // jamás en la línea de caída ni bajo el muro
    if (Math.abs(x) < ctx.corridor.halfX - 0.2 && z > ctx.corridor.zMin && z < ctx.corridor.zMax) continue;
    if (z > ctx.wallZ + 1.2) continue;
    const s = 0.3 + vnoise(k * 3.3, 2.2, seed ^ 0x6b) * 0.38;
    out.push([x, z, s]);
  }
  return out;
}

/**
 * T101 — TARRONES DE CAMPO [x, z, escala]: trozos de roca SOBRESALIENTES por
 * TODO el suelo visible (petición: «material que recuerde mucho más al
 * material de la base.glb… trozos sobresalientes de rocas… haciéndolo
 * extensible a todo el suelo que vemos»), de la MISMA familia de roca que el
 * anillo del campamento: la base deja de ser una isla. Determinista; fuera de
 * la franja de caída, del pie del muro (ahí viven las rocas del pedriz) y de
 * la explanada del GLB (ahí manda su anillo).
 */
export function scatterFieldBoulders(cfg: GroundTintCfg, ctx: GroundTintCtx): [number, number, number][] {
  const out: [number, number, number][] = [];
  const seed = (cfg.seed ^ 0x101b) >>> 0;
  for (let k = 0; k < 500 && out.length < 24; k++) {
    const r1 = vnoise(k * 1.23 + 2.6, k * 0.71 + 5.4, seed);
    const r2 = vnoise(k * 0.67 + 8.8, k * 1.37 + 1.5, seed ^ 0x3c);
    const r3 = vnoise(k * 1.77 + 6.1, k * 0.91 + 7.3, seed ^ 0x59);
    const x = (r1 - 0.5) * 2 * 18.5; // suelo visible: 40 m de ancho
    const z = (r2 - 0.5) * 2 * 10.5; // … 24 de fondo (del pedriz al borde)
    // franja de caída con colchón (aterrizaje siempre legible)
    if (Math.abs(x) < ctx.corridor.halfX + 0.9 && z > ctx.corridor.zMin - 0.5 && z < ctx.corridor.zMax + 0.9) continue;
    // pie del muro/pedriz: territorio del derrubio (scatterRocks)
    if (z < ctx.wallZ + 1.1) continue;
    // explanada del campamento: su anillo de bloques ya abraza el GLB
    if (ctx.cabin && Math.hypot(x - ctx.cabin.x, z - ctx.cabin.z) < ctx.cabin.r + 2.1) continue;
    const s = 0.16 + r3 * 0.34; // pequeños-medianos: composición, no obstáculos
    out.push([x, z, s]);
  }
  return out;
}
