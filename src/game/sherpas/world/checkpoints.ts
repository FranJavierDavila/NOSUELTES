// CheckpointSystem (petición del jugador): "Cada 10 metros podemos tener un
// checkpoint desde el que poder continuar la ascensión sin tener que volver al
// principio". Cada cota es una línea verde discontinua que atraviesa la pared
// (también en el minimapa); al alcanzarla por primera vez aparecen banderitas
// en sus extremos. Si el equipo cae, reaparece en la ÚLTIMA cota fijada — se
// pierde altura, no la ascensión (coherente con la filosofía anti-reset).
import type { CampZone } from "./wallGenerator";
import { computeCheckpointYs } from "../gameplay/devMode"; // T114: misma regla para el panel dev

export interface Checkpoint {
  /** orden ascendente (0 = la más baja). */
  index: number;
  /** altura de PARED de la cota (m desde la base). */
  y: number;
  reached: boolean;
}

export class CheckpointSystem {
  readonly list: Checkpoint[] = [];
  private reachedCount_ = 0;

  constructor(stepM: number, totalHeightM: number, campZones: CampZone[]) {
    // T114: la regla de cotas vive en devMode.ts (la comparte el panel dev)
    for (const y of computeCheckpointYs(stepM, totalHeightM, campZones)) {
      this.list.push({ index: this.list.length, y, reached: false });
    }
  }

  reachedCount(): number { return this.reachedCount_; }

  /** T114 MODO DEV: fija como alcanzadas TODAS las cotas hasta y (coherencia
   *  al saltar a un tramo: el respawn y el HUD ven el ascenso «hecho»). */
  markUpTo(y: number): void {
    for (const cp of this.list) {
      if (!cp.reached && cp.y <= y) {
        cp.reached = true;
        this.reachedCount_++;
      }
    }
  }

  /** Marca cotas alcanzadas (basta que UN escalador cruce la línea: son de
   *  equipo). Devuelve las recién fijadas este tick. */
  tick(waistAY: number, waistBY: number): Checkpoint[] {
    const best = Math.max(waistAY, waistBY);
    const fresh: Checkpoint[] = [];
    for (const cp of this.list) {
      if (!cp.reached && cp.y <= best) {
        cp.reached = true;
        this.reachedCount_++;
        fresh.push(cp);
      }
    }
    return fresh;
  }

  /** La cota alcanzada MÁS ALTA por debajo de y (candidata a respawn). */
  highestAtOrBelow(y: number): Checkpoint | null {
    let best: Checkpoint | null = null;
    for (const cp of this.list) {
      if (cp.reached && cp.y <= y + 0.4 && (!best || cp.y > best.y)) best = cp;
    }
    return best;
  }

  /** Altura de la cota más alta fijada (sonda E2E/HUD). */
  highestReachedY(): number | null {
    let best: number | null = null;
    for (const cp of this.list) {
      if (cp.reached && (best === null || cp.y > best)) best = cp.y;
    }
    return best;
  }
}
