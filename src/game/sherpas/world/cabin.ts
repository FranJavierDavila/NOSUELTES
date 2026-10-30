// T56 — CABAÑA SHERPA (base de partida de la escalada). Petición del jugador:
// "un modelo 3d de una Cabaña sherpa que se supone que es la Base de partida
// de la escalada (posteriormente se colocarán modelos 3d personalizados, ahora
// es solo relleno)".
//
// Módulo PURO (sin Babylon): devuelve la LISTA DE PIEZAS (cajas/cilindros/
// triángulos) en un marco local con origen en el centro del suelo de la
// cabaña, más el humo de la chimenea y los BANDERINES DE REZO colgados de una
// cuerda entre el apex del tejado y un poste. La escena lo materializa con
// MeshBuilder (1 merge por material) y da vida a los banderines con el plugin
// de viento de la vegetación (T55) — ondean con la MISMA brisa/rachas reales.
//
// Escala humana (~2 m de cumbrera): la cabaña es pequeña junto a la pared de
// 30 m, como corresponde a un campamento base. Low-poly coherente con el
// estilo del resto de props (cápsulas, cajas de presas, ledges).

export type CabinMat = "stone" | "wood" | "woodDark" | "roof" | "glass";

export interface CabinPiece {
  kind: "box" | "cyl" | "tri";
  name: string;
  mat: CabinMat;
  pos: [number, number, number];
  /** box: [w,h,d]; cyl: [dTop,dBot,height]; tri: sin uso (a/b/c). */
  size: [number, number, number];
  /** rotación en grados (Euler XYZ). */
  rotDeg: [number, number, number];
  /** tri: vértices locales. */
  a?: [number, number, number];
  b?: [number, number, number];
  c?: [number, number, number];
}

export interface FlagPendant {
  /** vértices superiores (atados a la cuerda, bend 0). */
  tL: [number, number, number];
  tR: [number, number, number];
  /** vértices inferiores (libres, bend 1). */
  bL: [number, number, number];
  bR: [number, number, number];
  /** color base RGB 0..1 (vertex color). */
  color: [number, number, number];
  /** fase del ondeo (0..1). */
  phase: number;
}

export interface CabinSpec {
  pieces: CabinPiece[];
  /** boca de la chimenea (marco local). */
  smokePos: [number, number, number];
  /** cuerda de banderines: tramos [p0..p1] colineales con sag (marco local). */
  rope: { from: [number, number, number]; to: [number, number, number]; sag: number };
  flagPendants: FlagPendant[];
}

// banderines de rezo tibetanos (azul, blanco, rojo, verde, amarillo — ciclo)
export const FLAG_COLORS: [number, number, number][] = [
  [0.18, 0.44, 0.7],
  [0.91, 0.9, 0.87],
  [0.7, 0.22, 0.18],
  [0.18, 0.55, 0.31],
  [0.85, 0.71, 0.23],
];

const hex = (c: [number, number, number]): [number, number, number] =>
  [c[0]!, c[1]!, c[2]!];

const piece = (
  name: string, mat: CabinMat, pos: [number, number, number], size: [number, number, number],
  rotDeg: [number, number, number] = [0, 0, 0],
): CabinPiece => ({ kind: "box", name, mat, pos, size, rotDeg });

/**
 * Spec determinista de la cabaña. Todas las medidas en metros del marco local
 * (origen = centro del suelo). La escena coloca el conjunto con un transform
 * (posición + giro) — nada de esto depende del mundo.
 */
export function buildCabinSpec(): CabinSpec {
  const pieces: CabinPiece[] = [
    // zócalo de piedra (asienta en el pedriz)
    piece("zocalo", "stone", [0, 0.2, 0], [2.34, 0.42, 1.84]),
    // muro de madera
    piece("muro", "wood", [0, 0.94, 0], [2.1, 1.08, 1.6]),
    // viga de cumbrera frontal + jambas de puerta
    piece("vigaFrontal", "woodDark", [0, 1.5, 0.79], [2.16, 0.09, 0.09]),
    piece("puerta", "woodDark", [-0.46, 0.89, 0.8], [0.62, 0.96, 0.07]),
    piece("jambaL", "woodDark", [-0.82, 1.1, 0.8], [0.08, 0.5, 0.09]),
    piece("jambaR", "woodDark", [-0.1, 1.1, 0.8], [0.08, 0.5, 0.09]),
    // ventana con marco (cristal translúcido aparte, mismo hueco)
    piece("ventMarco", "woodDark", [0.5, 1.16, 0.8], [0.64, 0.56, 0.05]),
    piece("ventCristal", "glass", [0.5, 1.16, 0.82], [0.5, 0.42, 0.03]),
    // AGUAS del tejado (cajas inclinadas; el apex queda en y≈2.06)
    { kind: "box", name: "aguaZp", mat: "roof", pos: [0, 1.77, 0.42], size: [2.52, 0.07, 1.02], rotDeg: [-33, 0, 0] },
    { kind: "box", name: "aguaZn", mat: "roof", pos: [0, 1.77, -0.42], size: [2.52, 0.07, 1.02], rotDeg: [33, 0, 0] },
    // gables triangulares (frente y fondo)
    { kind: "tri", name: "gableF", mat: "woodDark", pos: [0, 0, 0], size: [0, 0, 0], rotDeg: [0, 0, 0], a: [-1.04, 1.46, 0.79], b: [1.04, 1.46, 0.79], c: [0, 2.06, 0.79] },
    { kind: "tri", name: "gableB", mat: "woodDark", pos: [0, 0, 0], size: [0, 0, 0], rotDeg: [0, 0, 0], a: [1.04, 1.46, -0.79], b: [-1.04, 1.46, -0.79], c: [0, 2.06, -0.79] },
    // chimenea de piedra + boca
    piece("chimenea", "stone", [0.72, 1.9, -0.34], [0.34, 0.9, 0.34]),
    piece("chimeneaBoca", "stone", [0.72, 2.36, -0.34], [0.44, 0.1, 0.44]),
    // cajas de suministro apiladas (relleno de campamento)
    { kind: "box", name: "caja1", mat: "woodDark", pos: [1.42, 0.21, 0.62], size: [0.56, 0.42, 0.46], rotDeg: [0, 14, 0] },
    { kind: "box", name: "caja2", mat: "woodDark", pos: [1.4, 0.59, 0.6], size: [0.46, 0.34, 0.4], rotDeg: [0, -11, 0] },
    // poste de los banderines
    { kind: "cyl", name: "poste", mat: "woodDark", pos: [1.68, 0.72, 0.98], size: [0.05, 0.065, 1.44], rotDeg: [0, 0, 0] },
  ];

  // cuerda de banderines: apex frontal del tejado → top del poste, con comba
  const from: [number, number, number] = [0.15, 2.04, 0.84];
  const to: [number, number, number] = [1.68, 1.42, 0.98];
  const sag = 0.22;

  const flagPendants: FlagPendant[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = 0.1 + (i / (N - 1)) * 0.78; // a lo largo de la cuerda (sin tocar extremos)
    // punto de la cuerda con comba parabólica
    const cx = from[0]! + (to[0]! - from[0]!) * t;
    const cy0 = from[1]! + (to[1]! - from[1]!) * t;
    const cy = cy0 - sag * 4 * t * (1 - t);
    const cz = from[2]! + (to[2]! - from[2]!) * t;
    // ancho del banderín perpendicular aproximado (la cuerda corre ~+x)
    const w = 0.105;
    const h = 0.21;
    const color = hex(FLAG_COLORS[i % FLAG_COLORS.length]!);
    // la tela cuelga un pelín hacia fuera (+z) y deriva con el "viento" base
    const drift = 0.035 * i;
    flagPendants.push({
      tL: [cx - w, cy, cz],
      tR: [cx + w, cy, cz],
      bL: [cx - w + drift * 0.4, cy - h, cz + 0.045 + drift],
      bR: [cx + w + drift * 0.4, cy - h - 0.015, cz + 0.045 + drift],
      color,
      phase: i / N,
    });
  }

  return {
    pieces,
    smokePos: [0.72, 2.46, -0.34],
    rope: { from, to, sag },
    flagPendants,
  };
}

/**
 * Punto de la cuerda de banderines en t∈[0,1] (con comba). Lo usa la escena
 * para dibujar los segmentos de cuerda.
 */
export function flagRopePoint(rope: CabinSpec["rope"], t: number): [number, number, number] {
  const { from, to, sag } = rope;
  const x = from[0]! + (to[0]! - from[0]!) * t;
  const y0 = from[1]! + (to[1]! - from[1]!) * t;
  const y = y0 - sag * 4 * t * (1 - t);
  const z = from[2]! + (to[2]! - from[2]!) * t;
  return [x, y, z];
}
