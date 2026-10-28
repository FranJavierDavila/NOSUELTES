// CheckpointSystem (petición del jugador): "Cada 10 metros podemos tener un
// checkpoint desde el que poder continuar la ascensión sin tener que volver al
// principio". Cada cota es una línea verde discontinua que atraviesa la pared
// (también en el minimapa); al alcanzarla por primera vez aparecen banderitas
// en sus extremos. Si el equipo cae, reaparece en la ÚLTIMA cota fijada — se
// pierde altura, no la ascensión (coherente con la filosofía anti-reset).
import type { CampZone } from "./wallGenerator";

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
    const step = Math.max(2, stepM);
    for (let y = step; y <= totalHeightM - 2; y += step) {
      // las cotas DENTRO de una zona de campamento se saltan: el campamento ya
      // es punto de respawn con visuales, descanso y guardado propios.
      if (campZones.some((c) => y >= c.yBase - 0.5 && y <= c.yTop + 0.5)) continue;
      this.list.push({ index: this.list.length, y, reached: false });
    }
  }

  reachedCount(): number { return this.reachedCount_; }

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
