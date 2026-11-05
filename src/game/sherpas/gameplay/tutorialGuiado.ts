// T114 — TUTORIAL GUIADO (petición del jugador): «un outboarding o tutorial
// inicial que sea una pequeña partida guiada desde el principio donde se
// enseña con uno de los sherpas las mecánicas y tengamos que repetirlo con el
// otro. Un tutorial completamente visual... explicaciones muy visuales tipo
// "Para movernos: arrastra con el puntero sobre una extremidad y muévela a un
//  anclaje cercano disponible" ... ahora tu turno (y el jugador repite) ...
//  indicaciones con flechitas ... así con todas las mecánicas».
//
// ARQUITECTURA: es una PARTIDA REAL local (tranquila) con un director que
//  · guioniza al sherpa PROFESOR (el naranja, J1) con las MISMAS primitivas
//    que el jugador (aim, toggleGrip, drag del ratón beginDrag/moveDrag/
//    devDragUp, ancla de seguro, caída real, a saco sintético por intents);
//  · filtra la entrada del jugador (mixer) entre fases DEMO (todo bloqueado)
//    y TURNO (solo pasa el sherpa AZUL, J2);
//  · DETECTA el acierto con sondas del match (presa agarrada, anclaje
//    portátil gastado, seguro activo, ropeState de vuelta a climbing);
//  · pinta FLECHAS y tarjeta con chips de teclas (ui/tutorialGuiadoUI).
// Los TEXTOS viven en strings_<idioma>.json (regla de oro, doc 11): aquí solo
// claves. Las fases se avanzan solas o con CTA; «Repetir demo» re-ensaya.
import type { InputIntent, OrbitAxis } from "../input/input";
import type { MatchInputSource, SherpasMatch } from "./match";
import type { Limb } from "../core/bus";
import type { V3 } from "../../physics/pbd/math";
import { v3 } from "../../physics/pbd/math";
import type { SherpaRig } from "../physics/sherpaRig";
import { TutorialGuiadoUI, tutRich, type ArrowPx } from "../ui/tutorialGuiadoUI";

const TEACHER = 0 as const;
const STUDENT = 1 as const;
const AMBER = "#fbbf24";
const GREEN = "#5ad46a";

/** Lo que el director necesita del HUD (structural: evita el import cíclico). */
export interface TutorialHudView {
  t(key: string): string;
  subtitle(text: string, durS?: number): void;
}

export interface TutorialDeps {
  match: SherpasMatch;
  hud: TutorialHudView;
  hudRoot: HTMLElement;
  /** mundo → px CSS (la misma proyección que la sonda E2E). */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** cámara: scene.setCamPin (null libera). */
  camPin(p: { x: number; y: number; z: number } | null, dist?: number): void;
  /** objeto COMPARTIDO del mount (el mismo que lee el match). */
  dragLock: { player: 0 | 1 | null };
  /** al terminar o saltar (el mount marca el onboarding como visto). */
  onDone(): void;
}

// ---------- guion del profesor (acciones encadenadas) ----------

type ScriptAction =
  | { k: "wait"; s: number }
  | { k: "aim"; x: number; y: number; s: number }
  | { k: "drag"; limb: Limb; x: number; y: number; s: number }
  | { k: "grip"; limb: Limb }
  | { k: "call"; fn: (d: TutorialDirector) => void }
  | { k: "mash"; on: boolean; p?: 0 | 1 };

class ScriptRunner {
  private idx = 0;
  private t = 0;
  private from: { x: number; y: number } | null = null;
  private moveT = 0;
  private stallT = 0;
  done = false;
  constructor(private readonly actions: ScriptAction[]) { }
  /** avanza; true si la lista terminó. beginDrag denegado se reintenta con
   *  tope de 3 s por acción (un fallo NUNCA rompe el tutorial). */
  tick(d: TutorialDirector, dt: number): boolean {
    if (this.done) return true;
    let guard = 0;
    while (this.idx < this.actions.length && guard++ < 6) {
      const a = this.actions[this.idx]!;
      if (a.k === "wait") {
        this.t += dt;
        if (this.t < a.s) return false;
        this.t = 0; this.idx++; continue;
      }
      if (a.k === "aim") {
        const rig = d.match.devRig(TEACHER);
        if (!this.from) { this.from = { x: rig.aim.x, y: rig.aim.y }; this.moveT = 0; }
        this.moveT += dt;
        const f = Math.min(1, this.moveT / Math.max(0.05, a.s));
        rig.aim.x = this.from.x + (a.x - this.from.x) * f;
        rig.aim.y = this.from.y + (a.y - this.from.y) * f;
        if (f < 1) return false;
        this.from = null; this.moveT = 0; this.idx++; continue;
      }
      if (a.k === "drag") {
        const rig = d.match.devRig(TEACHER);
        if (!this.from) {
          const lp = rig.limbPos(a.limb);
          this.from = { x: lp.x, y: lp.y };
          this.moveT = 0;
          if (!rig.beginDrag(a.limb)) {
            this.stallT += dt; // extremidad ocupada/bloqueada: reintento
            if (this.stallT > 3) { this.from = null; this.stallT = 0; this.idx++; }
            return false;
          }
        }
        this.moveT += dt;
        const f = Math.min(1, this.moveT / Math.max(0.05, a.s));
        rig.moveDrag(v3(
          this.from.x + (a.x - this.from.x) * f,
          this.from.y + (a.y - this.from.y) * f,
          d.wallFrontZ(),
        ));
        if (f < 1) return false;
        d.match.devDragUp(TEACHER, a.limb, a.x, a.y);
        this.from = null; this.moveT = 0; this.stallT = 0; this.idx++; continue;
      }
      if (a.k === "grip") {
        d.match.devRig(TEACHER).toggleGrip(a.limb);
        this.idx++; continue;
      }
      if (a.k === "mash") {
        d.setMash(a.p ?? TEACHER, a.on);
        this.idx++; continue;
      }
      // call: puede lanzar (presas ausentes…) — el guion sigue igualmente
      try { a.fn(d); } catch { /* acción fallida: continuar */ }
      this.idx++; continue;
    }
    this.done = this.idx >= this.actions.length;
    return this.done;
  }
  abort(): void { this.done = true; }
}

// ---------- pasos ----------

interface StepState {
  t: number;
  script: ScriptRunner | null;
  /** caché por paso: objetivos, baselines, temporizadores de aviso… */
  data: Record<string, unknown>;
}

interface StepDef {
  readonly id: string;
  readonly phase: "cine" | "demo" | "turno";
  readonly titleKey: string;
  readonly bodyKey?: string;
  /** cuerpo compuesto en código (cheat-sheet del último paso). */
  bodyFn?: (d: TutorialDirector) => string;
  readonly ctaKey?: string;
  /** «Repetir demo» vuelve a este paso id. */
  readonly demoId?: string;
  enter(d: TutorialDirector, s: StepState): void;
  /** "ok" avanza al siguiente paso. */
  tick(d: TutorialDirector, s: StepState, dt: number): "wait" | "ok";
  arrows(d: TutorialDirector, s: StepState): { from: V3; to: V3; label: string; color: string }[];
  focus(d: TutorialDirector, s: StepState): { p: V3; dist: number } | null;
}

/** presas agarradas del jugador al entrar (baseline de «muévete»). */
function gripBaseline(rig: SherpaRig): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const l of ["hand_l", "hand_r", "foot_l", "foot_r"] as const) out[l] = rig.gripHoldId(l);
  return out;
}

/** script listo → "ok" (los pasos de demo terminan cuando su guion acaba). */
function scriptDone(d: TutorialDirector, s: StepState, dt: number): "wait" | "ok" {
  return s.script?.tick(d, dt) ?? true ? "ok" : "wait";
}

const STEPS: StepDef[] = [
  {
    id: "objetivo", phase: "cine", titleKey: "guiado.s1.title", bodyKey: "guiado.s1.body",
    ctaKey: "guiado.cta.ok",
    enter: () => { /* cámara por fases en focus() */ },
    tick: () => "wait", // manual: CTA «Entendido»
    arrows: (d, s) => {
      if (s.t < 3.0) return [];
      const r = d.richPos();
      return [{ from: r, to: v3(r.x, r.y + 2.4, r.z), label: d.t("guiado.arrow.cima"), color: AMBER }];
    },
    focus: (d, s) => s.t < 3.0
      ? { p: d.summit(), dist: 46 }   // primero LA CIMA: a donde hay que llegar
      : { p: d.richPos(), dist: 6 },  // luego el Ricachón: a quien llevamos
  },
  {
    id: "mover_demo", phase: "demo", titleKey: "guiado.s2.title", bodyKey: "guiado.s2.body",
    enter: (d, s) => {
      const rig = d.match.devRig(TEACHER);
      const hand = rig.limbPos("hand_r");
      const hold = d.match.devHoldNear(hand.x, hand.y, { maxDist: 2.0, minDy: 0.35, maxDy: 1.5 });
      const target = hold ? { x: hold.x, y: hold.y } : { x: hand.x, y: hand.y + 0.9 };
      s.data.target = target;
      s.script = new ScriptRunner([
        { k: "wait", s: 1.1 },
        { k: "drag", limb: "hand_r", x: target.x, y: target.y, s: 1.7 },
        { k: "wait", s: 0.9 },
      ]);
    },
    tick: scriptDone,
    arrows: (d, s) => {
      const tg = s.data.target as { x: number; y: number } | undefined;
      if (!tg) return [];
      const rig = d.match.devRig(TEACHER);
      return [{ from: rig.limbPos("hand_r"), to: v3(tg.x, tg.y, d.wallFrontZ()), label: d.t("guiado.arrow.arrastra"), color: AMBER }];
    },
    focus: (d) => ({ p: d.match.devRig(TEACHER).waist(), dist: 5.5 }),
  },
  {
    id: "mover_tu", phase: "turno", titleKey: "guiado.s3.title", bodyKey: "guiado.s3.body",
    demoId: "mover_demo",
    enter: (d, s) => {
      s.data.base = gripBaseline(d.match.devRig(STUDENT));
      s.data.hintAt = 0;
    },
    tick: (d, s, dt) => {
      const rig = d.match.devRig(STUDENT);
      const base = s.data.base as Record<string, string | null>;
      for (const l of Object.keys(base)) {
        const now = rig.gripHoldId(l as Limb);
        if (now && now !== base[l]) { d.flash(); return "ok"; }
      }
      s.data.hintAt = ((s.data.hintAt as number) ?? 0) + dt;
      if ((s.data.hintAt as number) > 9) {
        s.data.hintAt = 0;
        d.hint("guiado.hint.mover");
      }
      return "wait";
    },
    arrows: (d) => {
      const rig = d.match.devRig(STUDENT);
      const hand = rig.limbPos("hand_r");
      const hold = d.match.devHoldNear(hand.x, hand.y, { maxDist: 2.2, minDy: 0.3, maxDy: 1.6 });
      if (!hold) return [];
      return [{ from: hand, to: v3(hold.x, hold.y, d.wallFrontZ()), label: d.t("guiado.arrow.suelta"), color: GREEN }];
    },
    focus: (d) => ({ p: d.match.devRig(STUDENT).waist(), dist: 5.5 }),
  },
  {
    id: "mochila_demo", phase: "demo", titleKey: "guiado.s4.title", bodyKey: "guiado.s4.body",
    enter: (d, s) => {
      const rig = d.match.devRig(TEACHER);
      const hand = rig.limbPos("hand_r");
      // hueco de pared libre cerca de la mano (sin presa en 0,7 m)
      let sx = hand.x + 0.4, sy = hand.y + 0.75;
      for (let i = 0; i < 6 && d.match.devHoldNear(sx, sy, { maxDist: 0.7 }); i++) {
        sx += 0.25; sy += 0.1;
      }
      s.data.spot = { x: sx, y: sy };
      s.script = new ScriptRunner([
        { k: "wait", s: 0.7 },
        { k: "call", fn: (dd) => dd.match.requestPortablePlace(TEACHER) }, // ARMA (queda en la mano)
        { k: "wait", s: 0.6 },
        { k: "drag", limb: "hand_r", x: sx, y: sy, s: 1.5 }, // soltar la mano = CLAVADO
        { k: "wait", s: 1.0 },
      ]);
    },
    tick: scriptDone,
    arrows: (d, s) => {
      const spot = s.data.spot as { x: number; y: number } | undefined;
      if (!spot) return [];
      const rig = d.match.devRig(TEACHER);
      return [{ from: rig.limbPos("hand_r"), to: v3(spot.x, spot.y, d.wallFrontZ()), label: d.t("guiado.arrow.clava"), color: AMBER }];
    },
    focus: (d) => ({ p: d.match.devRig(TEACHER).waist(), dist: 5.5 }),
  },
  {
    id: "mochila_tu", phase: "turno", titleKey: "guiado.s5.title", bodyKey: "guiado.s5.body",
    demoId: "mochila_demo",
    enter: (d, s) => {
      s.data.left0 = d.match.portableRemaining(STUDENT);
      s.data.hintAt = 0;
    },
    tick: (d, s, dt) => {
      if (d.match.portableRemaining(STUDENT) < (s.data.left0 as number)) {
        d.flash(); return "ok";
      }
      s.data.hintAt = ((s.data.hintAt as number) ?? 0) + dt;
      if ((s.data.hintAt as number) > 9) {
        s.data.hintAt = 0;
        d.hint("guiado.hint.mochila");
      }
      return "wait";
    },
    arrows: (d) => {
      const rig = d.match.devRig(STUDENT);
      const hand = rig.limbPos("hand_r");
      return [{ from: hand, to: v3(hand.x, hand.y + 1.0, d.wallFrontZ()), label: d.t("guiado.arrow.clava"), color: GREEN }];
    },
    focus: (d) => ({ p: d.match.devRig(STUDENT).waist(), dist: 5.5 }),
  },
  {
    id: "seguro_demo", phase: "demo", titleKey: "guiado.s6.title", bodyKey: "guiado.s6.body",
    enter: (_d, s) => {
      s.script = new ScriptRunner([
        { k: "wait", s: 0.7 },
        { k: "call", fn: (dd) => dd.match.debugForce("ancla", TEACHER) }, // pipeline REAL (validaciones incluidas)
        { k: "wait", s: 1.4 },
      ]);
    },
    tick: scriptDone,
    arrows: (d) => {
      const w = d.match.devRig(TEACHER).waist();
      return [{ from: v3(w.x, w.y + 1.7, w.z), to: w, label: d.t("guiado.arrow.ancla"), color: AMBER }];
    },
    focus: (d) => ({ p: d.match.devRig(TEACHER).waist(), dist: 6 }),
  },
  {
    id: "seguro_tu", phase: "turno", titleKey: "guiado.s7.title", bodyKey: "guiado.s7.body",
    demoId: "seguro_demo",
    enter: (_d, s) => { s.data.hintAt = 0; },
    tick: (d, s, dt) => {
      if (d.match.devRig(STUDENT).belaying) { d.flash(); return "ok"; }
      s.data.hintAt = ((s.data.hintAt as number) ?? 0) + dt;
      if ((s.data.hintAt as number) > 8) {
        s.data.hintAt = 0;
        d.hint("guiado.hint.seguro");
      }
      return "wait";
    },
    arrows: (d) => {
      const w = d.match.devRig(STUDENT).waist();
      return [{ from: v3(w.x, w.y + 1.7, w.z), to: w, label: d.t("guiado.arrow.ancla"), color: GREEN }];
    },
    focus: (d) => ({ p: d.match.devRig(STUDENT).waist(), dist: 6 }),
  },
  {
    id: "asaco_demo", phase: "demo", titleKey: "guiado.s8.title", bodyKey: "guiado.s8.body",
    enter: (_d, s) => {
      s.data.sawHang = false;
      s.script = new ScriptRunner([
        { k: "call", fn: (dd) => { try { dd.match.debugForce("ancla", TEACHER); } catch { /* no estaba */ } } },
        { k: "wait", s: 0.5 },
        { k: "call", fn: (dd) => dd.match.debugForce("caida", TEACHER) }, // caída REAL → cuelga de la cuerda
        { k: "wait", s: 1.4 }, // gracia de la ventana de a saco
        { k: "mash", on: true, p: TEACHER }, { k: "mash", on: true, p: STUDENT }, // LOS DOS
      ]);
    },
    tick: (d, s, dt) => {
      const st = d.match.devRig(TEACHER).ropeState;
      if (st !== "climbing") s.data.sawHang = true;
      s.script?.tick(d, dt);
      if (s.data.sawHang && st === "climbing") {
        d.setMash(TEACHER, false); d.setMash(STUDENT, false);
        return "ok";
      }
      return "wait";
    },
    arrows: (d) => {
      const w = d.match.devRig(TEACHER).waist();
      return [{ from: v3(w.x + 0.4, w.y + 1.6, w.z), to: w, label: d.t("guiado.arrow.machaca"), color: AMBER }];
    },
    focus: (d) => ({ p: d.match.devRig(TEACHER).waist(), dist: 6.5 }),
  },
  {
    id: "asaco_tu", phase: "turno", titleKey: "guiado.s9.title", bodyKey: "guiado.s9.body",
    demoId: "asaco_demo",
    enter: (d, s) => {
      s.data.sawHang = false;
      s.data.hintAt = 0;
      s.data.cool = 0;
      s.data.recalled = false;
      // si el profesor está en la pared, NUEVA caída para repetir el rescate
      if (d.match.devRig(TEACHER).ropeState === "climbing") {
        try { d.match.debugForce("caida", TEACHER); } catch { /* sin presas: seguir */ }
      }
      s.script = new ScriptRunner([{ k: "mash", on: true, p: TEACHER }]); // él ya pulsa la suya
    },
    tick: (d, s, dt) => {
      const rig = d.match.devRig(TEACHER);
      const st = rig.ropeState;
      if (st !== "climbing" && st !== "grounded") s.data.sawHang = true;
      s.script?.tick(d, dt);
      s.data.cool = ((s.data.cool as number) ?? 0) - dt;
      if (st === "grounded" && !(s.data.recalled as boolean) && (s.data.cool as number) <= 0) {
        // tocó el suelo sin machacar: rescate del guion y OTRA vez
        d.match.devRecallRig(TEACHER);
        d.setMash(TEACHER, false);
        s.data.sawHang = false;
        s.data.recalled = true;
        s.data.cool = 1.6;
      }
      if ((s.data.recalled as boolean) && (s.data.cool as number) <= 0 && rig.ropeState === "climbing") {
        try { d.match.debugForce("caida", TEACHER); } catch { /* sin presas: esperar */ }
        s.data.recalled = false;
      }
      s.data.hintAt = ((s.data.hintAt as number) ?? 0) + dt;
      if ((s.data.hintAt as number) > 8) {
        s.data.hintAt = 0;
        d.hint("guiado.hint.asaco");
      }
      if ((s.data.sawHang as boolean) && st === "climbing") {
        d.setMash(TEACHER, false);
        d.flash();
        return "ok";
      }
      return "wait";
    },
    arrows: (d) => {
      const w = d.match.devRig(TEACHER).waist();
      return [{ from: v3(w.x + 0.4, w.y + 1.6, w.z), to: w, label: d.t("guiado.arrow.machaca"), color: GREEN }];
    },
    focus: (d) => ({ p: d.match.devRig(TEACHER).waist(), dist: 6.5 }),
  },
  {
    id: "sorpresas", phase: "cine", titleKey: "guiado.s10.title", bodyKey: "guiado.s10.body",
    ctaKey: "guiado.cta.vamos",
    enter: (_d, s) => { s.data.condorAt = 1.2; }, // el cóndor cruza al abrir el paso
    tick: (d, s, dt) => {
      s.data.condorAt = ((s.data.condorAt as number) ?? 0) - dt;
      if ((s.data.condorAt as number) <= 0) {
        s.data.condorAt = 1e9; // una sola vez
        try { d.match.debugForce("condor"); } catch { /* sin cóndor: no pasa nada */ }
      }
      return "wait"; // manual: CTA
    },
    arrows: () => [],
    focus: (d) => ({ p: d.richPos(), dist: 8 }),
  },
  {
    id: "fin", phase: "cine", titleKey: "guiado.s11.title",
    bodyFn: (d) =>
      tutRich(`**${d.t("keys.p1")}**\n**${d.t("keys.p2")}**\n${d.t("keys.shared")}`).replace(/\n/g, "<br>"),
    ctaKey: "guiado.cta.escalar",
    enter: () => { /* el finish() libera candados */ },
    tick: () => "wait", // CTA «¡A ESCALAR!» → onDone
    arrows: () => [],
    focus: (d) => ({ p: d.richPos(), dist: 9 }),
  },
];

// ---------- director ----------

export class TutorialDirector {
  private ui: TutorialGuiadoUI;
  private idx = 0;
  private st: StepState = { t: 0, script: null, data: {} };
  private time = 0;
  private camAt = 0;
  detached = false;

  private mash: [boolean, boolean] = [false, false];

  constructor(
    readonly match: SherpasMatch,
    private readonly deps: TutorialDeps,
  ) {
    this.ui = new TutorialGuiadoUI(deps.hudRoot, {
      onSkip: () => this.skip(),
      onCta: () => this.advance(),
      onRepeat: () => this.replayDemo(),
    });
    this.ui.show(STEPS.length);
    this.enterStep(0);
  }

  // --- helpers usados por los pasos ---
  t(key: string): string { return this.deps.hud.t(key); }
  hint(key: string): void {
    try { this.deps.hud.subtitle(this.t(key), 3.2); } catch { /* sin hud: seguir */ }
  }
  flash(): void { this.ui.flash(this.t("guiado.flash"), this.time); }
  setMash(p: 0 | 1, on: boolean): void { this.mash[p] = on; }
  richPos(): V3 {
    return (this.match as unknown as { rich?: { pelvis(): V3 } }).rich?.pelvis() ?? v3(0, 1, 0);
  }
  summit(): V3 { return v3(0, this.match.tutorialTotalHeightM(), this.match.tutorialWallFrontZ()); }
  wallFrontZ(): number { return this.match.tutorialWallFrontZ(); }

  /** EL mixer llama aquí cada frame (poll del match). Devuelve los intents
   *  que el match aplica: en demo/cine NADA del jugador (solo los sintéticos
   *  del guion); en turno, solo los del sherpa AZUL. */
  filterIntents(base: InputIntent[], dt: number): InputIntent[] {
    if (this.detached) return base;
    this.tick(dt);
    const out: InputIntent[] = [];
    const turno = STEPS[this.idx]?.phase === "turno";
    for (const it of base) if (turno && it.playerId === STUDENT) out.push(it);
    if (this.mash[TEACHER]) out.push(mashIntent(TEACHER));
    if (this.mash[STUDENT]) out.push(mashIntent(STUDENT));
    return out;
  }

  private tick(dt: number): void {
    this.time += dt;
    const step = STEPS[this.idx];
    if (!step) return;
    this.st.t += dt;
    let res: "wait" | "ok" = "wait";
    try { res = step.tick(this, this.st, dt); } catch { res = "wait"; }
    this.updateCamera(step);
    this.updateUi(step);
    if (res === "ok") this.next();
  }

  private updateCamera(step: StepDef): void {
    if (this.time < this.camAt) return;
    this.camAt = this.time + 0.3;
    let target: { p: V3; dist: number } | null = null;
    try { target = step.focus(this, this.st); } catch { target = null; }
    if (target) this.deps.camPin({ x: target.p.x, y: target.p.y, z: target.p.z }, target.dist);
    else this.deps.camPin(null);
  }

  private updateUi(step: StepDef): void {
    const body = step.bodyFn ? step.bodyFn(this) : step.bodyKey ? tutRich(this.t(step.bodyKey)) : "";
    this.ui.setStep({
      index: this.idx,
      total: STEPS.length,
      title: this.t(step.titleKey),
      bodyHtml: body,
      phase: step.phase,
      cta: step.ctaKey ? this.t(step.ctaKey) : null,
      repeatable: !!step.demoId,
    }, this.t("guiado.nowSub"), this.time);
    const arrows: ArrowPx[] = [];
    let list: { from: V3; to: V3; label: string; color: string }[] = [];
    try { list = step.arrows(this, this.st); } catch { list = []; }
    for (const a of list) {
      const p0 = this.deps.project(a.from.x, a.from.y, a.from.z);
      const p1 = this.deps.project(a.to.x, a.to.y, a.to.z);
      if (p0 && p1) arrows.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, label: a.label, color: a.color });
    }
    this.ui.frame(arrows, this.time);
  }

  private enterStep(i: number): void {
    this.idx = Math.max(0, Math.min(STEPS.length - 1, i));
    this.st = { t: 0, script: null, data: {} };
    const step = STEPS[this.idx]!;
    // candados CENTRALIZADOS por fase: en demo/cine el jugador no toca nada
    // (ni ratón — tutLock — ni teclado — el mixer filtra); en turno, solo el
    // AZUL es arrastrable con el ratón (dragLock) y el teclado pasa.
    this.match.tutLock = step.phase !== "turno";
    this.deps.dragLock.player = step.phase === "turno" ? STUDENT : null;
    try { step.enter(this, this.st); } catch { /* el paso sigue sin guion */ }
  }

  private next(): void {
    if (this.idx + 1 >= STEPS.length) { this.finish(); return; }
    this.enterStep(this.idx + 1);
  }

  /** CTA manual (Entendido / ¡Vamos allá! / ¡A ESCALAR!). */
  advance(): void {
    if (this.detached) return;
    const step = STEPS[this.idx]!;
    if (!step.ctaKey) return;
    if (step.id === "fin") { this.finish(); return; }
    this.next();
  }

  /** «Repetir demo»: vuelve al paso de demostración del paso actual. */
  replayDemo(): void {
    if (this.detached) return;
    const step = STEPS[this.idx]!;
    if (!step.demoId) return;
    const di = STEPS.findIndex((s) => s.id === step.demoId);
    if (di >= 0) this.enterStep(di);
  }

  skip(): void { this.finish(); }

  /** Repetir el tutorial completo (cheat-sheet): reinicia estado y equipo. */
  restart(): void {
    if (this.detached) return;
    try {
      this.match.devRefillPortables();
      this.match.devRespawn("inicio", 0);
    } catch { /* la pared siempre está: nunca debería fallar */ }
    this.setMash(TEACHER, false); this.setMash(STUDENT, false);
    this.enterStep(0);
  }

  private finish(): void {
    if (this.detached) return;
    this.detached = true;
    this.setMash(TEACHER, false); this.setMash(STUDENT, false);
    this.match.tutLock = false;
    this.deps.dragLock.player = null;
    this.deps.camPin(null);
    this.ui.hide();
    this.deps.onDone();
  }

  dispose(): void {
    if (!this.detached) this.finish();
    this.ui.dispose();
  }
}

function mashIntent(p: 0 | 1): InputIntent {
  return {
    playerId: p,
    aimDelta: { x: 0, y: 0 },
    gripToggles: [],
    shoo: false,
    fart: false,
    anchor: false,
    impulse: false,
    place: false,
    arm: false,
    mashCount: 2,
  };
}

// ---------- mixer (el mismo puesto que HostInputMixer en red) ----------

/** Sustituye al InputManager ANTE el match mientras dura el tutorial: en
 *  cine/demo bloquea al jugador y ejecuta el guion; en turno deja pasar solo
 *  al AZUL. Comparte órbita de cámara y vista libre con el input real. */
export class TutorialMixer implements MatchInputSource {
  private director: TutorialDirector | null = null;
  constructor(private readonly local: MatchInputSource) { }
  attach(d: TutorialDirector | null): void { this.director = d; }
  poll(dt: number): InputIntent[] {
    const base = this.local.poll(dt);
    const d = this.director;
    if (!d || d.detached) return base;
    return d.filterIntents(base, dt);
  }
  orbitAxis(): OrbitAxis { return this.local.orbitAxis(); }
  freeViewHeld(): boolean { return this.local.freeViewHeld(); }
}
