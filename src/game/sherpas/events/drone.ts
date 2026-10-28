// DroneSystem (petición del jugador: "de vez en cuando aparece un DRON volando
// y le deja una sorpresa al lado en la tabla, y la desequilibra un poco — los
// pesos en la tabla son elementos de descompensación"). FSU corta y legible:
// approach (vuela hacia un punto SOBRE la tabla, cerca del ricachón) → hover
// (ronda con el paquete colgando y BALANCEÁNDOSE) → release (suelta: la llamada
// `deliver` del match convierte el paquete en CARGA persistente) → depart
// (se marcha ganando altura) → idle. No ataca a nadie: su arma es el PESO.
import type { EventBus } from "../core/bus";
import type { DroneTuning } from "../core/data";
import { makeRng, type Rng } from "../core/rng";
import { v3, vAdd, vScale, vSub, vLen, type V3 } from "../../physics/pbd/math";

export type DronePhase = "idle" | "approach" | "hover" | "depart";

export interface DroneWorld {
  /** pose actual de la tabla (centro, ángulo, semilargo, z). */
  plankPose(): { center: V3; angle: number; halfLen: number; z: number };
  /** deslizamiento del ricachón sobre la tabla (m): el paquete cae A SU LADO. */
  richSlideM(): number;
  /** ¿se puede entregar? (tabla en el aire, no cayendo, no en el suelo). */
  plankOk(): boolean;
}

export const DRONE_DEFAULTS: DroneTuning = {
  massKgMin: 5, massKgMax: 11, speedMs: 2.6, hoverSeconds: 2.2,
};

const DEPART_SECONDS = 2.6;

export class DroneSystem {
  phase: DronePhase = "idle";
  phaseTime = 0;
  pos: V3 = v3(0, 0, 0);
  /** fracción de tabla donde soltará el paquete (−1 cabo izq … +1 cabo der). */
  dropFrac = 0;
  /** peso del paquete en vuelo (kg) — se fija al spawn. */
  kg = 0;
  private from: V3 = v3(0, 0, 0);
  private rng: Rng;
  private tuning: DroneTuning;

  constructor(tuning: DroneTuning | undefined, private world: DroneWorld, private events: EventBus, seed: number) {
    this.tuning = tuning ?? DRONE_DEFAULTS;
    this.rng = makeRng(seed ^ 0xd20e);
  }

  /** Punto de la tabla donde va a soltar el paquete: JUNTO al ricachón — si él
   *  está desplazado, un poco más hacia el centro (que el paquete no lo empuje
   *  fuera, solo lo DESCOMPENSE). */
  private dropPoint(): V3 {
    const pose = this.world.plankPose();
    const lx = Math.cos(pose.angle) * pose.halfLen * this.dropFrac;
    const ly = Math.sin(pose.angle) * pose.halfLen * this.dropFrac;
    return v3(pose.center.x + lx, pose.center.y + ly + 0.16, pose.z + 0.05);
  }

  /** Lanza una entrega (el director la pide). False si ya hay una en vuelo o
   *  la tabla no está en condiciones (suelo/caída). */
  spawn(): boolean {
    if (this.phase !== "idle" || !this.world.plankOk()) return false;
    // al lado del ricachón: su slide (m) → fracción, empujado 0,18 m hacia el centro
    const pose = this.world.plankPose();
    const slideFrac = this.world.richSlideM() / Math.max(0.5, pose.halfLen);
    const nudge = slideFrac >= 0 ? -0.18 / pose.halfLen : 0.18 / pose.halfLen;
    this.dropFrac = Math.max(-0.72, Math.min(0.72, slideFrac + nudge));
    if (Math.abs(this.dropFrac) < 0.14) this.dropFrac = (this.rng.next() < 0.5 ? -1 : 1) * 0.3;
    this.kg = this.rng.range(this.tuning.massKgMin, this.tuning.massKgMax);
    const side = this.dropFrac >= 0 ? 1 : -1;
    this.from = v3(pose.center.x + side * 7.5, pose.center.y + 4.2, pose.z - 1.6);
    this.pos = v3(this.from.x, this.from.y, this.from.z);
    this.phase = "approach";
    this.phaseTime = 0;
    this.events.emit("Telegraph", { eventId: "drone", seconds: 1.8 });
    return true;
  }

  /** Paso del dron. `deliver(frac, kg)` lo llama el tick EXACTO de la suelta. */
  tick(dt: number, time: number, deliver: (frac: number, kg: number) => void): void {
    if (this.phase === "idle") return;
    this.phaseTime += dt;
    const target = this.dropPoint();
    const hover = vAdd(target, v3(0, 1.55, -1.1)); // ronda ALTO y cerca de la cámara: se lee y no lo tapa la burbuja del ricachón
    switch (this.phase) {
      case "approach": {
        const to = vSub(hover, this.pos);
        const d = vLen(to) || 1e-6;
        const step = this.tuning.speedMs * dt;
        // vuelo con vaivén de dron (se corrige en el punto todo el rato)
        this.pos = vAdd(this.pos, vAdd(vScale(to, Math.min(1, step / d)), v3(Math.sin(time * 3.1) * 0.25 * dt, Math.sin(time * 2.2) * 0.18 * dt, 0)));
        if (d < 0.18 || this.phaseTime > 14) {
          this.phase = "hover";
          this.phaseTime = 0;
        }
        break;
      }
      case "hover": {
        // ronda con el paquete colgando (el balanceo lo pinta la escena)
        this.pos = vAdd(hover, v3(Math.sin(time * 2.3) * 0.07, Math.sin(time * 1.7) * 0.05, 0));
        if (this.phaseTime >= this.tuning.hoverSeconds) {
          deliver(this.dropFrac, this.kg);
          this.phase = "depart";
          this.phaseTime = 0;
        }
        break;
      }
      case "depart": {
        // se marcha hacia arriba y a su lado, acelerando
        const side = this.dropFrac >= 0 ? 1 : -1;
        this.pos = vAdd(this.pos, v3(side * 3.4 * dt, 2.8 * dt, 1.4 * dt));
        if (this.phaseTime >= DEPART_SECONDS) {
          this.phase = "idle";
          this.phaseTime = 0;
        }
        break;
      }
    }
  }

  /** Datos para el render (null = no hay dron que dibujar). */
  renderPos(): V3 | null { return this.phase === "idle" ? null : v3(this.pos.x, this.pos.y, this.pos.z); }
  /** el paquete aún cuelga del dron mientras vuela hacia la tabla y durante el hover. */
  pkgCarried(): boolean { return this.phase === "approach" || this.phase === "hover"; }

  /** Vuelve a idle (respawn de equipo: no hay entrega en curso). */
  reset(): void {
    this.phase = "idle";
    this.phaseTime = 0;
  }
}
