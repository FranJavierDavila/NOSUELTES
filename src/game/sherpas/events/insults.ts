// Banco de insultos (doc 7.2): selección sin repetición reciente (memoria de 15),
// pesos por contexto. El tono lo marca el contenido de los datos (guía 7.2).
import type { InsultBank } from "../core/data";
import { makeRng, type Rng } from "../core/rng";

export const INSULT_MEMORY = 15;

export class InsultSystem {
  private memory: string[] = [];
  private rng: Rng;

  constructor(private bank: InsultBank, seed: number) {
    this.rng = makeRng(seed ^ 1337);
  }

  /** Elige línea del contexto evitando las últimas 15 (doc 7.2.2). */
  pick(context: string): string | null {
    const pool = this.bank[context];
    if (!pool || pool.length === 0) return null;
    const fresh = pool.filter((line) => !this.memory.includes(line));
    const source = fresh.length ? fresh : pool;
    const line = this.rng.pick(source);
    this.memory.push(line);
    if (this.memory.length > INSULT_MEMORY) this.memory.shift();
    return line;
  }

  contexts(): string[] { return Object.keys(this.bank); }
}
