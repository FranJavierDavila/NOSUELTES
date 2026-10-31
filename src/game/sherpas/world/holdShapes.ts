// holdShapes — RECETAS DE FORMA DE LAS PRESAS (T63, petición del jugador:
// "los anclajes podrían parecer más naturales como elementos de la propia
// pared pero bien identificados... que se note cuáles son agarres normales,
// cuáles frágiles"). Antes TODAS las presas eran la misma esfera lisa con un
// color plano por tipo: la pared leía uniforme y los tipos no se entendían.
//
// Ahora cada tipo de anclaje es una FORMA natural de roca/hielo construida
// por receta determinista:
//  · roca firme  → BULTO de piedra con cara agarrable y MANCHA DE MAGNESIO
//                  (la señal real de "aquí se agarra bien") sobre la textura
//                  de la propia pared (material de roca del muro, UV de mundo).
//  · roca suelta → LOSA ASTILLADA: más plana, INCLINADA, con GRIETAS oscuras
//                  y tinte oxidado — se ve frágil SIN leerse como elemento
//                  ajeno a la pared.
//  · hielo       → CARÁMBANOS aglomerados translúcidos (hielo), película
//                  fina, placa pálida; hielo de pis amarillento (humor).
//  · nieve       → MUÑÓN blando blanco.
//  · apoyo sorpresa → bulbo VERDE luminoso (seguía siendo distinto a posta).
//
// Núcleo PURO (doc 3): la receta es serializable y no toca Babylon — la
// escena ESTAMPA esferas/cajas según la receta. Determinismo total: la
// variante se elige por hash del id de la presa (misma pared → mismas formas
// en cada reconstrucción) y los tints mezclan el color del TIPO (paleta de
// anchor_types/daltonismo) sobre tonos de roca, para que la identificación
// por color de la UI y la del mundo cuenten la misma historia.

export type HoldMaterialKind = "rock" | "ice" | "snow" | "glow";

/** Una esfera deformada (elipsoide) de la forma: posición relativa al centro
 *  de la presa (metros), radios por eje (relativos a 0,5 = la esfera vieja)
 *  y tinte por vértice 0..1 (se multiplica sobre la textura de roca). */
export interface HoldShapePart {
  x: number;
  y: number;
  z: number;
  /** radios por eje en METROS (la presa vieja media 0,22 de diámetro). */
  rx: number;
  ry: number;
  rz: number;
  /** color por vértice del trozo (rgba, alpha siempre 1). */
  tint: [number, number, number];
}

/** GRIETA: caja fina oscura cruzando la cara (solo roca suelta). */
export interface HoldShapeCrack {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ry: number;
  rz: number;
}

export interface HoldShapeRecipe {
  kind: HoldMaterialKind;
  parts: HoldShapePart[];
  /** mancha de magnesio (elipsoide aplastado, tinte blanco hueso). */
  chalk: { x: number; y: number; z: number; rx: number; ry: number; rz: number } | null;
  cracks: HoldShapeCrack[];
  /** vuelco de la LOSA suelta (rad, x/z de la instancia). */
  tilt: [number, number];
  alpha: number;
  rough: number;
  /** emisivo del material (apoyo sorpresa). */
  emissive: [number, number, number] | null;
  /** escala extra de la instancia (además del estirado z que muerde la pared). */
  scale: number;
}

/** Tipos conocidos (anchor_types.json). Cualquier OTRO tipo → receta de bulto
 *  neutro (defensivo: un tipo nuevo jamás debe romper la escena). */
const KIND_BY_TYPE: Record<string, HoldMaterialKind> = {
  rock_firm: "rock",
  rock_loose: "rock",
  ice: "ice",
  ice_thin: "ice",
  ice_plate: "ice",
  ice_urine: "ice",
  snow: "snow",
  surprise_fart: "glow",
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** hash determinista de string (FNV-1a 32 bit) — variante por id de presa. */
export function holdVariantForId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Mezcla un hex (#rrggbb) sobre tonos neutrales con la fuerza dada. */
function tintToward(typeHex: string | undefined, k: number, base: [number, number, number]): [number, number, number] {
  const hex = /^#[0-9a-fA-F]{6}$/.test(typeHex ?? "") ? (typeHex as string) : null;
  if (!hex || k <= 0) return base;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [mix(base[0], r, k), mix(base[1], g, k), mix(base[2], b, k)];
}

/** Ruido determinista 0..1 anclado a (tipo, variante) — jitter de receta. */
function jit(type: string, variant: number, salt: number): number {
  const h = holdVariantForId(`${type}#${variant}#${salt}`);
  return (h % 10000) / 10000;
}

/**
 * Receta de forma para UNA variante del tipo dado. `typeHex` = color del tipo
 * (paleta de anchor_types.json / daltonismo) — el mundo y la UI cuentan lo
 * mismo: la forma manda (bulto/losa/carámbano) y el tinte acompaña.
 */
export function holdShapeRecipe(type: string, variant: number, typeHex?: string): HoldShapeRecipe {
  const kind = KIND_BY_TYPE[type] ?? "rock";
  const v = Number.isFinite(variant) ? Math.abs(Math.floor(variant)) : 0;
  const rec: HoldShapeRecipe = {
    kind,
    parts: [],
    chalk: null,
    cracks: [],
    tilt: [0, 0],
    alpha: 1,
    rough: 0.62,
    emissive: null,
    scale: 1,
  };

  if (type === "rock_loose") {
    // LOSA ASTILLADA (frágil SE VEE frágil): placa más plana e inclinada,
    // tinte oxidado, 2-3 grietas oscuras y una lasca que sobresale.
    const ox = tintToward(typeHex, 0.45, [0.62, 0.5, 0.38]);
    const ox2 = tintToward(typeHex, 0.3, [0.52, 0.42, 0.33]);
    rec.tilt = [(jit(type, v, 1) - 0.5) * 0.34, (jit(type, v, 2) - 0.5) * 0.4];
    rec.rough = 0.8;
    rec.parts.push(
      // placa principal, baja y ancha
      { x: 0, y: 0, z: 0, rx: 0.115, ry: 0.085, rz: 0.15, tint: ox },
      // lasca desprendida que apunta hacia fuera
      { x: (jit(type, v, 3) - 0.5) * 0.08, y: 0.055 + jit(type, v, 4) * 0.03, z: 0.05, rx: 0.05, ry: 0.032, rz: 0.055, tint: ox2 },
      // saliente bajo (el hueco de la rotura)
      { x: (jit(type, v, 5) - 0.5) * 0.1, y: -0.05, z: -0.01, rx: 0.07, ry: 0.045, rz: 0.07, tint: ox2 },
    );
    const cw = 0.16 + jit(type, v, 6) * 0.1;
    rec.cracks.push(
      { x: -0.02, y: 0.01, z: 0.105, w: cw, h: 0.012, d: 0.02, ry: 0.12 + jit(type, v, 7) * 0.5, rz: (jit(type, v, 8) - 0.5) * 0.5 },
      { x: 0.025, y: -0.02, z: 0.108, w: 0.1 + jit(type, v, 9) * 0.08, h: 0.01, d: 0.02, ry: -0.3 - jit(type, v, 10) * 0.4, rz: (jit(type, v, 11) - 0.5) * 0.4 },
    );
    return rec;
  }

  if (kind === "ice") {
    // CARÁMBANOS aglomerados: 2-3 conos de hielo (esferas estiradas) con
    // alpha translúcido; el tipo afina el tinte (azul hielo / fino / placa
    // pálida / pis amarillento).
    const icy = tintToward(typeHex, 0.75, [0.72, 0.87, 0.95]);
    const icy2 = tintToward(typeHex, 0.6, [0.6, 0.78, 0.9]);
    rec.alpha = type === "ice_thin" ? 0.58 : type === "ice_plate" ? 0.7 : 0.78;
    rec.rough = type === "ice_plate" ? 0.24 : 0.32;
    const n = 2 + Math.floor(jit(type, v, 12) * 2); // 2-3 dedos de hielo
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + jit(type, v, 20 + i) * 2.2;
      const rr = 0.032 + jit(type, v, 30 + i) * 0.028;
      rec.parts.push({
        x: Math.cos(a) * 0.035,
        y: 0.02 + jit(type, v, 40 + i) * 0.03,
        z: Math.sin(a) * 0.02,
        rx: rr,
        ry: 0.085 + jit(type, v, 50 + i) * 0.06,
        rz: rr,
        tint: i % 2 === 0 ? icy : icy2,
      });
    }
    // base helada que solda con la pared
    rec.parts.push({ x: 0, y: -0.02, z: -0.01, rx: 0.08, ry: 0.05, rz: 0.07, tint: icy2 });
    return rec;
  }

  if (kind === "snow") {
    // MUÑÓN DE NIEVE blando (se hunde al agarrarlo: slip en la física).
    rec.rough = 0.55;
    rec.parts.push(
      { x: 0, y: 0.005, z: 0.01, rx: 0.105, ry: 0.085, rz: 0.12, tint: tintToward(typeHex, 0.5, [0.95, 0.96, 0.97]) },
      { x: (jit(type, v, 13) - 0.5) * 0.07, y: 0.055, z: 0.02, rx: 0.06, ry: 0.045, rz: 0.06, tint: [0.98, 0.99, 1] },
    );
    return rec;
  }

  if (kind === "glow") {
    // APOYO SORPRESA: bulbo verde LUMINOSO (petición T: "más grande y
    // brillante — se ve desde lejos que esa presa es distinta").
    const g = tintToward(typeHex, 0.85, [0.2, 0.85, 0.35]);
    rec.rough = 0.45;
    rec.scale = 1.4;
    rec.emissive = [0.05, 0.45, 0.12];
    rec.parts.push(
      { x: 0, y: 0, z: 0.01, rx: 0.13, ry: 0.12, rz: 0.12, tint: g },
      { x: 0.03, y: 0.06, z: 0.04, rx: 0.05, ry: 0.045, rz: 0.05, tint: [0.5, 1, 0.55] },
    );
    return rec;
  }

  // Roca firme (y cualquier tipo desconocido): BULTO DE PIEDRA con hombro
  // agarrable + mancha de MAGNESIO (la señal de "buen agarre" de los rocos).
  const rock = tintToward(typeHex, 0.32, [0.66, 0.6, 0.5]);
  const rock2 = tintToward(typeHex, 0.22, [0.52, 0.47, 0.4]);
  rec.rough = 0.7;
  const j1 = jit(type, v, 14), j2 = jit(type, v, 15), j3 = jit(type, v, 16);
  rec.parts.push(
    // cuerpo principal: alto y profundo (se muerde la pared)
    { x: (j1 - 0.5) * 0.03, y: (j2 - 0.5) * 0.02, z: 0, rx: 0.095 + j1 * 0.03, ry: 0.085 + j2 * 0.025, rz: 0.105 + j3 * 0.04, tint: rock },
    // hombro superior (donde caen los dedos)
    { x: (j3 - 0.5) * 0.06, y: 0.055 + j1 * 0.02, z: 0.03, rx: 0.055, ry: 0.042, rz: 0.05, tint: rock2 },
    // contrafuerte bajo (la piedra nace de la pared, no flota)
    { x: (j2 - 0.5) * 0.05, y: -0.055, z: -0.015, rx: 0.06, ry: 0.04, rz: 0.06, tint: rock2 },
  );
  rec.chalk = {
    x: (j1 - 0.5) * 0.05,
    y: 0.07 + j2 * 0.02,
    z: 0.055 + j3 * 0.015,
    rx: 0.052,
    ry: 0.02,
    rz: 0.04,
  };
  return rec;
}

/** ¿El tipo se dibuja sobre la TEXTURA DE ROCA del muro (UV de mundo)? La
 *  escena lo usa para colgar el material de pared (presas integradas) o un
 *  material propio (hielo/nieve/brillo). */
export function holdUsesWallRock(type: string): boolean {
  return (KIND_BY_TYPE[type] ?? "rock") === "rock";
}
