// BirdSystem (doc 7.4): picador y ladrón con FSM data-driven (machines.json),
// telegrafía ≥ 1.2 s, aborto con shoo, equidad (máx 1 pájaro por sherpa y
// nunca dos ataques en menos de 6 s — doc 7.4.4).
import type { EventBus, Limb } from "../core/bus";
import type { MachinesData } from "../core/data";
import { makeRng, type Rng } from "../core/rng";
import { v3, vAdd, vScale, vSub, vLen, type V3 } from "../../physics/pbd/math";

export type BirdKind = "pecker" | "thief";
export type BirdPhase = "circle" | "telegraph" | "dive" | "impact" | "flee" | "despawn";

export interface BirdTargetReader {
  /** posición de la cintura de cada sherpa. */
  waist(player: 0 | 1): V3;
  /** extremidades agarradas por sherpa (exposición = menos agarres estables). */
  anchoredLimbs(player: 0 | 1): Limb[];
  limbWorldPos(player: 0 | 1, limb: Limb): V3;
}

interface Bird {
  id: number;
  kind: BirdKind;
  phase: BirdPhase;
  phaseTime: number;
  duration: number;
  targetPlayer: 0 | 1;
  targetLimb: Limb | null;
  pos: V3;
  vel: V3;
  aborted: boolean;
}

const FAIRY_MIN_ATTACK_GAP_S = 6;
const CIRCLE_RADIUS = 1.6;

export class BirdSystem {
  private birds: Bird[] = [];
  private nextId = 1;
  private lastAttackEnd = -999;
  private lastTargets: (0 | 1)[] = [];
  private rng: Rng;
  activeCount(): number { return this.birds.length; }

  constructor(private machines: MachinesData, private world: BirdTargetReader, private events: EventBus, seed: number) {
    this.rng = makeRng(seed ^ 0xbe4d);
  }

  /** EventDirector pide un ataque; respeta equidad (doc 7.4.4). */
  spawn(kind: BirdKind): boolean {
    const now = this.currentTimeS;
    if (now - this.lastAttackEnd < FAIRY_MIN_ATTACK_GAP_S) return false;
    const perPlayer = new Map<0 | 1, number>();
    for (const b of this.birds) perPlayer.set(b.targetPlayer, (perPlayer.get(b.targetPlayer) ?? 0) + 1);
    if (perPlayer.get(0)! >= 1 || perPlayer.get(1)! >= 1) return false;
    // objetivo: el sherpa con MÁS agarres estables (el de menos agarres evita repetición, doc 7.4.3).
    const anchors0 = this.world.anchoredLimbs(0).length;
    const anchors1 = this.world.anchoredLimbs(1).length;
    let target: 0 | 1;
    if (this.lastTargets.length && anchors0 === anchors1) {
      const avoid = this.lastTargets[this.lastTargets.length - 1];
      target = avoid === 0 ? 1 : 0;
    } else {
      target = anchors0 >= anchors1 ? 0 : 1;
    }
    const limbs = this.world.anchoredLimbs(target);
    const targetLimb = limbs.length ? this.rng.pick(limbs) : null;
    const machineName = kind === "pecker" ? "bird_pecker_fsm" : "bird_thief_fsm";
    const machine = this.machines.machines[machineName];
    if (!machine) return false;
    const circle = machine.states.circle;
    const bird: Bird = {
      id: this.nextId++,
      kind,
      phase: "circle",
      phaseTime: 0,
      duration: circle.durationRange ? this.rng.range(circle.durationRange[0], circle.durationRange[1]) : 3,
      targetPlayer: target,
      targetLimb,
      pos: vAdd(this.world.waist(target), v3((this.rng.next() - 0.5) * 4, CIRCLE_RADIUS + 1, -1.2)),
      vel: v3(0, 0, 0),
      aborted: false,
    };
    this.birds.push(bird);
    this.lastTargets.push(target);
    if (this.lastTargets.length > 4) this.lastTargets.shift();
    this.events.emit("BirdTelegraph", { birdId: bird.id, targetPlayer: target });
    return true;
  }

  private currentTimeS = 0;

  /** shoo del jugador: aborta si está en telegrafía (doc 7.4.4). */
  shoo(player: 0 | 1): boolean {
    let aborted = false;
    for (const b of this.birds) {
      if (b.targetPlayer === player && b.phase === "telegraph") {
        b.aborted = true;
        aborted = true;
      }
    }
    return aborted;
  }

  tick(dt: number, time: number, forceRelease: (player: 0 | 1, limb: Limb, lockS: number) => void): void {
    this.currentTimeS = time;
    const machine = this.machines.machines.bird_pecker_fsm;
    for (const b of [...this.birds]) {
      b.phaseTime += dt;
      const stName = b.phase === "impact" ? "impact" : b.phase;
      const st = machine.states[stName];
      const targetPos = b.targetLimb
        ? this.world.limbWorldPos(b.targetPlayer, b.targetLimb)
        : this.world.waist(b.targetPlayer);

      switch (b.phase) {
        case "circle": {
          const ang = time * 2 + b.id;
          b.pos = vAdd(targetPos, v3(Math.cos(ang) * CIRCLE_RADIUS, Math.sin(ang * 0.7) * 0.4 + CIRCLE_RADIUS, -1.1 + Math.sin(ang) * 0.3));
          if (b.phaseTime >= b.duration) this.toPhase(b, "telegraph", machine.states.telegraph.duration ?? 1.2);
          break;
        }
        case "telegraph": {
          b.pos = vAdd(targetPos, v3(0.4, 0.9, -0.9));
          if (b.aborted) {
            this.events.emit("BirdAborted", { birdId: b.id });
            this.toPhase(b, "flee", machine.states.flee.duration ?? 3);
            break;
          }
          if (b.phaseTime >= b.duration) {
            const dive = machine.states.dive;
            const dir = vScale(vSub(targetPos, b.pos), 1 / (vLen(vSub(targetPos, b.pos)) || 1));
            b.vel = vScale(dir, dive.speed ?? 9);
            this.toPhase(b, "dive", dive.duration ?? 0.6);
          }
          break;
        }
        case "dive": {
          b.pos = vAdd(b.pos, vScale(b.vel, dt));
          if (vLen(vSub(b.pos, targetPos)) < 0.28 || b.phaseTime >= b.duration) {
            // impacto
            if (b.kind === "pecker" && b.targetLimb) {
              forceRelease(b.targetPlayer, b.targetLimb, 0.8);
              this.events.emit("BirdHit", { birdId: b.id, playerId: b.targetPlayer, limb: b.targetLimb });
            } else {
              this.events.emit("BirdStolen", { birdId: b.id });
            }
            this.lastAttackEnd = time;
            this.toPhase(b, "flee", machine.states.flee.duration ?? 3);
          }
          break;
        }
        case "flee": {
          b.pos = vAdd(b.pos, v3(3.2 * dt, 4.5 * dt, 2.2 * dt));
          if (b.phaseTime >= b.duration) this.toPhase(b, "despawn", 0);
          break;
        }
        default: {
          this.birds = this.birds.filter((x) => x !== b);
        }
      }
    }
  }

  private toPhase(b: Bird, phase: BirdPhase, duration: number): void {
    b.phase = phase;
    b.phaseTime = 0;
    b.duration = duration;
  }

  /** posiciones para render. */
  birdsForRender(): { id: number; kind: BirdKind; pos: V3; phase: BirdPhase; targetPlayer: 0 | 1 }[] {
    return this.birds.map((b) => ({ id: b.id, kind: b.kind, pos: b.pos, phase: b.phase, targetPlayer: b.targetPlayer }));
  }
}
