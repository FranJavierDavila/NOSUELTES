/**
 * Geometria de paredes SEGMENTADAS (circuito con angulos, peticion del jugador:
 * "paredes horizontales ... mezcladas con paredes verticales a diferentes angulos").
 *
 * Modulo PURO y testeable: convierte los segmentos declarados en el JSON de pared
 * (franas apiladas bottom->top, cada una con su inclinacion) en marcos mundo que
 * consumen el solver (colision), la escena (render de boxes) y la interaccion
 * (alcance medido EN EL PLANO de la pared y plano de arrastre por segmento).
 *
 * Convencion de rotacion (Babylon left-handed, giro en X):
 *   up     = Rx(t) · (0, 1, 0)  = (0, cos t, sin t)
 *   normal = Rx(t) · (0, 0,-1)  = (0, sin t, -cos t)   (hacia el escalador/camara)
 *   tiltDeg 0   -> pared vertical (normal -z, como siempre).
 *   tiltDeg +18 -> placa: el top se aleja de la camara.
 *   tiltDeg -55 -> desplome fuerte: el top se acerca a la camara.
 *   tiltDeg -90 -> TECHO: plano horizontal, normal hacia ABAJO (se cuelga uno).
 * Los segmentos se apilan: el borde inferior de cada uno es el superior del
 * anterior (pared continua), el primero arranca en y=0, z=0.
 */

export interface Vec3Plain {
  x: number;
  y: number;
  z: number;
}

export interface WallFrame {
  index: number;
  /** Centro del borde inferior (mundo). */
  bottom: Vec3Plain;
  /** "Arriba local" del segmento (mundo, unitario). */
  up: Vec3Plain;
  /** Normal frontal (mundo, unitaria, hacia el escalador). */
  normal: Vec3Plain;
  /** Lateral (mundo, unitario): siempre X (las paredes solo giran en X). */
  right: Vec3Plain;
  /** Altura local del segmento (m). */
  height: number;
  tiltDeg: number;
  /** Centro del box (mundo) para el render. */
  center: Vec3Plain;
  halfWidth: number;
  depth: number;
  /** AABB mundo holgado (margen 0.15) para volúmenes de colisión/nearest. */
  aabb: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  name?: string;
}

export interface SegmentsInput {
  dimensions: { width: number; height: number; depth: number };
  segments?: { height: number; tiltDeg: number; name?: string }[];
}

const RAD = Math.PI / 180;
/** Margen del AABB de cada segmento (los pies/manos sobresalen de la cara). */
const AABB_MARGIN = 0.35;

/** Rota (0,1,0) y (0,0,-1) por Rx(t) y devuelve el marco del segmento apilado. */
export function computeWallFrames(wall: SegmentsInput): WallFrame[] {
  const d = wall.dimensions;
  const segs =
    wall.segments && wall.segments.length > 0
      ? wall.segments
      : [{ height: d.height, tiltDeg: 0 }];
  const frames: WallFrame[] = [];
  let by = 0;
  let bz = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const t = s.tiltDeg * RAD;
    const up = { x: 0, y: Math.cos(t), z: Math.sin(t) };
    const normal = { x: 0, y: Math.sin(t), z: -Math.cos(t) };
    const bottom = { x: 0, y: by, z: bz };
    const center = {
      x: 0,
      y: by + up.y * (s.height / 2),
      z: bz + up.z * (s.height / 2)
    };
    // Proyeccion exacta de las 4 aristas del box (giro en X: y/z se mezclan).
    const ys: number[] = [];
    const zs: number[] = [];
    for (const ly of [0, s.height]) {
      for (const lz of [-d.depth / 2, d.depth / 2]) {
        // Rx(t) sobre (0, ly, lz) respecto al borde inferior:
        const ry = ly * Math.cos(t) - lz * Math.sin(t);
        const rz = ly * Math.sin(t) + lz * Math.cos(t);
        ys.push(by + ry);
        zs.push(bz + rz);
      }
    }
    const aabb = {
      minX: -d.width / 2 - AABB_MARGIN,
      maxX: d.width / 2 + AABB_MARGIN,
      minY: Math.min(...ys) - AABB_MARGIN,
      maxY: Math.max(...ys) + AABB_MARGIN,
      minZ: Math.min(...zs) - AABB_MARGIN,
      maxZ: Math.max(...zs) + AABB_MARGIN
    };
    frames.push({
      index: i,
      bottom,
      up,
      normal,
      right: { x: 1, y: 0, z: 0 },
      height: s.height,
      tiltDeg: s.tiltDeg,
      center,
      halfWidth: d.width / 2,
      depth: d.depth,
      aabb,
      name: s.name
    });
    by += up.y * s.height;
    bz += up.z * s.height;
  }
  return frames;
}

/** Punto del plano FRONTAL del segmento (la cara contra la que se colisiona). */
export function facePoint(frame: WallFrame): Vec3Plain {
  const h = frame.depth / 2;
  return {
    x: frame.center.x,
    y: frame.center.y + frame.normal.y * h,
    z: frame.center.z + frame.normal.z * h
  };
}

/** Distancia con signo al plano frontal (positiva = del lado del escalador). */
export function signedDistance(frame: WallFrame, p: Vec3Plain): number {
  const f = facePoint(frame);
  return (p.x - f.x) * frame.normal.x + (p.y - f.y) * frame.normal.y + (p.z - f.z) * frame.normal.z;
}

/** Coordenadas locales (lateral, arriba) de un punto respecto al borde inferior. */
export function localCoords(frame: WallFrame, p: Vec3Plain): { lateral: number; along: number; depth: number } {
  const dx = p.x - frame.bottom.x;
  const dy = p.y - frame.bottom.y;
  const dz = p.z - frame.bottom.z;
  return {
    lateral: dx * frame.right.x + dy * frame.right.y + dz * frame.right.z,
    along: dx * frame.up.x + dy * frame.up.y + dz * frame.up.z,
    depth: signedDistance(frame, p)
  };
}

/**
 * Segmento que gobierna un punto: el mas cercano cuyo AABB (holgado) lo contiene;
 * si ninguno lo contiene, el de menor distancia absoluta a su plano frontal.
 */
export function segmentAtPoint(frames: WallFrame[], p: Vec3Plain): WallFrame {
  let best = frames[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const f of frames) {
    const inBox =
      p.x >= f.aabb.minX && p.x <= f.aabb.maxX &&
      p.y >= f.aabb.minY && p.y <= f.aabb.maxY &&
      p.z >= f.aabb.minZ && p.z <= f.aabb.maxZ;
    const d = Math.abs(signedDistance(f, p));
    const score = inBox ? d : d + 100;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/** AABB mundo que une todos los segmentos (limites del solver). */
export function framesBounds(frames: WallFrame[], halfWidth: number): {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
} {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const f of frames) {
    b.minX = Math.min(b.minX, f.aabb.minX);
    b.maxX = Math.max(b.maxX, f.aabb.maxX);
    b.minY = Math.min(b.minY, f.aabb.minY);
    b.maxY = Math.max(b.maxY, f.aabb.maxY);
    b.minZ = Math.min(b.minZ, f.aabb.minZ);
    b.maxZ = Math.max(b.maxZ, f.aabb.maxZ);
  }
  b.minX = Math.min(b.minX, -halfWidth);
  b.maxX = Math.max(b.maxX, halfWidth);
  return b;
}

/** Distancia EN EL PLANO de la pared entre dos puntos (marco del punto b). */
export function planeDistance(frame: WallFrame, a: Vec3Plain, b: Vec3Plain): number {
  const da = localCoords(frame, a);
  const db = localCoords(frame, b);
  return Math.hypot(db.lateral - da.lateral, db.along - da.along);
}

/** Top mundial de la pared (para la camara). */
export function framesTopY(frames: WallFrame[]): number {
  let top = 0;
  for (const f of frames) top = Math.max(top, f.aabb.maxY);
  return top;
}

/** Inclinacion mas desplomada de la pared (0 = vertical; 1 = techo -90). */
export function framesRoofFactor(frames: WallFrame[]): number {
  let worst = 0;
  for (const f of frames) worst = Math.min(worst, f.tiltDeg);
  return Math.min(1, Math.max(0, -worst / 90));
}
