/**
 * Motor del tutorial (logica pura, sin DOM ni Babylon): define los pasos del
 * onboarding interactivo y avanza segun el estado vivo del juego que llega en
 * TutorialCtx. El overlay (ui/tutorial.ts) solo pinta `current` y delega
 * advance/skip aqui. Probable de testear con vitest sin navegador.
 */
import type { LimbId, GameState } from "../types";

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
      title: "Este eres tú",
      body:
        "Tu cuerpo **cuelga de la pared**: la **mochila con tirantes** marca su espalda y la **cara con ojos** " +
        "sus discos turquesa, el frente. Los carteles **IZQ azul** y **DER rosa** nombran el lado de cada " +
        "mano y pie (igual que en el panel lateral). Cada extremidad se controla por separado con el raton: " +
        "no hay teletransporte y el peso se reparte **de verdad** entre tus apoyos.",
      highlightCharacter: true,
      advance: "manual",
      cta: "Entendido"
    },
    {
      id: "agarra",
      title: "1 · Agarra la mano",
      body:
        "Pulsa y **manten el clic izquierdo** sobre tu mano derecha — la del aro ambar. " +
        "Sigue la linea punteada si te pierdes.",
      highlightLimb: "hand_r",
      gesture: { from: "hand_r", to: "r2" },
      advance: "auto",
      done: (ctx) => ctx.dragging && ctx.selected === "hand_r"
    },
    {
      id: "arrastra",
      title: "2 · Llevala a la presa",
      body:
        "Sin soltar el boton, lleva el cursor hasta la presa resaltada. Cuando el alcance sea " +
        "valido veras un **aro verde** sobre ella.",
      highlightHold: "r2",
      gesture: { from: "hand_r", to: "r2" },
      advance: "auto",
      done: (ctx) => ctx.preview?.holdId === "r2" && ctx.preview.validity === "valid"
    },
    {
      id: "suelta",
      title: "3 · Suelta para fijar",
      body:
        "Suelta el boton **sobre la presa**. La mano viajara hasta ella y quedara anclada; " +
        "el cuerpo se reequilibrara con fisica real.",
      highlightHold: "r2",
      advance: "auto",
      done: (ctx) => ctx.anchors.hand_r === "r2"
    },
    {
      id: "cargas",
      title: "El peso se redistribuye",
      body:
        "Cada apoyo muestra su carga en vivo — **{load:hand_l}** en la mano izquierda y " +
        "**{load:hand_r}** en la derecha. Y lo mismo sobre el personaje: la extremidad fijada y el " +
        "**anillo de su presa** se tiñen **verde** (normal), **ambar** (tension) o **rojo parpadeante** " +
        "(sobrecarga). Si un agarre supera su limite se suelta: mueve **un apoyo cada vez**.",
      highlightHud: "hud-limbs",
      placement: "left",
      advance: "manual",
      cta: "Siguiente"
    },
    {
      id: "pies",
      title: "4 · Sube un pie",
      body:
        "Arrastra tu **pie izquierdo** a la presa resaltada. Al soltar, la pierna se **extiende y " +
        "empuja**: el cuerpo asciende y los brazos descargan. Apoyar pies es la diferencia " +
        "entre escalar y quedarte colgado.",
      highlightHold: "foot_jug_l",
      gesture: { from: "foot_l", to: "foot_jug_l" },
      advance: "auto",
      done: (ctx) => ctx.anchors.foot_l !== undefined || ctx.anchors.foot_r !== undefined
    },
    {
      id: "vitals",
      title: "Fatiga y estabilidad",
      body:
        "Este panel es tu vida: colgado solo de brazos la **fatiga sube** (ahora **{fatigue}**) y " +
        "con apoyos de pies baja. Menos fatiga = **mas fuerza de agarre**. Durante el tutorial va " +
        "ralentizada para que practiques sin caerte.",
      highlightHud: "hud-vitals",
      placement: "left",
      advance: "manual",
      cta: "Siguiente"
    },
    {
      id: "meta",
      title: "5 · La meta",
      body:
        "El ciclo para subir: **mano arriba** → **pie a un escalon alto** (el cuerpo se " +
        "recoloca solo) → repite. Lleva **ambas manos** a la presa dorada. Si una extremidad " +
        "pasa a **rojo (sobrecarga)**, apoya un pie o aliviala enseguida.",
      highlightHold: "top",
      advance: "manual",
      cta: "A escalar"
    },
    {
      id: "fin",
      title: "Listo para escalar",
      body:
        "`R` reinicia · `Espacio` pausa · `H` ayuda · `T` repite este tutorial · `F3` metricas. " +
        "Si un agarre falla, la caida te lo dira. Buena escalada.",
      highlightHud: "hud-keys",
      placement: "top",
      advance: "manual",
      cta: "Empezar a jugar"
    }
  ];
}
