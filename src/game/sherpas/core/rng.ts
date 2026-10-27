// Core: RNG determinista (mulberry32) — semilla compartida host/cliente (doc 8.1.5)
export type Seed = number;

export function mulberry32(seed: Seed): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  weighted(weights: Record<string, number>): string;
}

export function makeRng(seed: Seed): Rng {
  const base = mulberry32(seed);
  const next = () => base();
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (weights) => {
      const entries = Object.entries(weights).filter(([, w]) => w > 0);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      if (total <= 0) return Object.keys(weights)[0] ?? "";
      let roll = next() * total;
      for (const [id, w] of entries) {
        roll -= w;
        if (roll <= 0) return id;
      }
      return entries[entries.length - 1][0];
    },
  };
}
