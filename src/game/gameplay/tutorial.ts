/**
 * Motor del tutorial (logica pura, sin DOM ni Babylon): define los pasos del
 * onboarding interactivo y avanza segun el estado vivo del juego que llega en
 * TutorialCtx. El overlay (ui/tutorial.ts) solo pinta `current` y delega
 * advance/skip aqui. Probable de testear con vitest sin navegador.
 */
import type { LimbId, GameState } from "../types";
import { t } from "../ui/i18n";

export interface TutorialCtx {
  state: GameState;
  /** limb -> holdId anclado actualmente. */
  anchors: Partial<Record<LimbId, string>>;
  /** Carga medida por extremidad (N, redondeada). */
  loads: Partial<Record<LimbId, number>>;
  selected: LimbId | null;
  dragging: boolean;
  preview: { holdId: string | null; validity: string } | null;
  supportCount: number;
  fatigueMax: number;
}

/** Lado preferente de la tarjeta respecto al objetivo. */
export type TutorialPlacement = "left" | "right" | "top" | "bottom";

export interface TutorialStepDef {
  id: string;
  title: string;
  /**
   * Texto del paso. Markup admitido por el overlay: **negrita**, `tecla`
   * (chip kbd) y placeholders vivos {load:limb} / {fatigue}.
   */
  body: string;
  /** Resalta la extremidad en 3D y pone el spotlight sobre ella. */
  highlightLimb?: LimbId;
  /** Resalta la presa en 3D y pone el spotlight sobre ella. */
  highlightHold?: string;
  /** Spotlight sobre un elemento del HUD por id (hud-limbs, hud-vitals...). */
  highlightHud?: string;
  /** Spotlight eliptico alrededor del personaje completo. */
  highlightCharacter?: boolean;
  /** Demo animada: trayectoria punteada de la extremidad a la presa. */
  gesture?: { from: LimbId; to: string };
  /** Lado preferente de la tarjeta; si no, eleccion automatica. */
  placement?: TutorialPlacement;
  /** auto: avanza cuando `done(ctx)` es verdadero. manual: requiere boton. */
  advance: "auto" | "manual";
  done?: (ctx: TutorialCtx) => boolean;
  /** Etiqueta del boton de avance manual. */
  cta?: string;
}

/** Sustituye placeholders del texto con valores vivos del contexto. */
export function fillStepText(text: string, ctx: TutorialCtx): string {
  return text.replace(/\{load:(\w+)\}/g, (_m, limb: string) => {
    const v = ctx.loads[limb as LimbId];
    return v === undefined ? "—" : `${v} N`;
  }).replace(/\{fatigue\}/g, `${Math.round(ctx.fatigueMax * 100)} %`);
}

export class TutorialEngine {
  private idx = 0;
  private finishedFlag = false;

  constructor(
    private readonly steps: TutorialStepDef[],
    private readonly onChange: () => void
  ) {}

  get current(): TutorialStepDef | null {
    return this.finishedFlag ? null : this.steps[this.idx] ?? null;
  }

  get progress(): string {
    return `${Math.min(this.idx + 1, this.steps.length)}/${this.steps.length}`;
  }

  get isFinished(): boolean {
    return this.finishedFlag;
  }

  /** Llamar cada frame con el estado vivo; avanza pasos automaticos. */
  tick(ctx: TutorialCtx): void {
    const step = this.current;
    if (!step || step.advance !== "auto" || !step.done) return;
    if (step.done(ctx)) this.next();
  }

  /** Avance manual (boton del overlay); ignorado en pasos automaticos. */
  advance(): void {
    if (this.current?.advance === "manual") this.next();
  }

  skip(): void {
    if (this.finishedFlag) return;
    this.finishedFlag = true;
    this.onChange();
  }

  private next(): void {
    this.idx++;
    if (this.idx >= this.steps.length) this.finishedFlag = true;
    this.onChange();
  }
}

/**
 * Ruta guiada sobre el desafio ALCANZAR con objetivos verificados en el juego
 * real: hand_r->r2 es valido desde la pose inicial (golden path E2E), un pie
 * alcanza foot_jug_l y la cima se deja en juego libre. Cada paso declara su
 * objetivo VISUAL (limb/hold/hud/personaje) y, si procede, la demo de arrastre.
 */
export function buildTutorialSteps(): TutorialStepDef[] {
  return [
    {
      id: "bienvenida",
      title: t("tutorial.s1.title"),
      body: t("tutorial.s1.body"),
      highlightCharacter: true,
      advance: "manual",
      cta: t("tutorial.cta.ok")
    },
    {
      id: "agarra",
      title: t("tutorial.s2.title"),
      body: t("tutorial.s2.body"),
      highlightLimb: "hand_r",
      gesture: { from: "hand_r", to: "r2" },
      advance: "auto",
      done: (ctx) => ctx.dragging && ctx.selected === "hand_r"
    },
    {
      id: "arrastra",
      title: t("tutorial.s3.title"),
      body: t("tutorial.s3.body"),
      highlightHold: "r2",
      gesture: { from: "hand_r", to: "r2" },
      advance: "auto",
      done: (ctx) => ctx.preview?.holdId === "r2" && ctx.preview.validity === "valid"
    },
    {
      id: "suelta",
      title: t("tutorial.s4.title"),
      body: t("tutorial.s4.body"),
      highlightHold: "r2",
      advance: "auto",
      done: (ctx) => ctx.anchors.hand_r === "r2"
    },
    {
      id: "cargas",
      title: t("tutorial.s5.title"),
      body: t("tutorial.s5.body"),
      highlightHud: "hud-limbs",
      placement: "left",
      advance: "manual",
      cta: t("tutorial.cta.next")
    },
    {
      id: "pies",
      title: t("tutorial.s6.title"),
      body: t("tutorial.s6.body"),
      highlightHold: "foot_jug_l",
      gesture: { from: "foot_l", to: "foot_jug_l" },
      advance: "auto",
      done: (ctx) => ctx.anchors.foot_l !== undefined || ctx.anchors.foot_r !== undefined
    },
    {
      id: "vitals",
      title: t("tutorial.s7.title"),
      body: t("tutorial.s7.body"),
      highlightHud: "hud-vitals",
      placement: "left",
      advance: "manual",
      cta: t("tutorial.cta.next")
    },
    {
      id: "meta",
      title: t("tutorial.s8.title"),
      body: t("tutorial.s8.body"),
      highlightHold: "top",
      advance: "manual",
      cta: t("tutorial.cta.climb")
    },
    {
      id: "fin",
      title: t("tutorial.s9.title"),
      body: t("tutorial.s9.body"),
      highlightHud: "hud-keys",
      placement: "top",
      advance: "manual",
      cta: t("tutorial.cta.play")
    }
  ];
}
