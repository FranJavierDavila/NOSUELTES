/**
 * DebugOverlay (seccion 12.3): metricas, estados, vectores y visualizacion de articulaciones.
 * Solo desarrollo: nunca cambia el estado del juego.
 */
import { LimbId } from "../types";
import { LIMB_IDS } from "../types";

export interface DebugLimbInfo {
  state: string;
  holdId: string | null;
  loadN: number;
  effectiveN: number;
  ratio: number;
  fatigue: number;
  zone: string;
}

export interface DebugData {
  fps: number;
  backend: string;
  physicsMs: number;
  bodies: number;
  constraints: number;
  anchors: number;
  state: string;
  gameTime: number;
  com: { x: number; y: number; z: number };
  stability: number;
  supportCount: number;
  tone: number;
  limbs: Record<LimbId, DebugLimbInfo>;
  flags: { axes: boolean; joints: boolean; reach: boolean; raycast: boolean };
}

export interface TuneValues {
  postureTone: number;
  jointLimitStiffness: number;
  foldStrength: number;
  stretchTolerance: number;
}

export type TuneKey = keyof TuneValues;

export class DebugOverlay {
  private panel: HTMLElement;
  private rows: Record<string, HTMLElement> = {};
  private visible = false;
  private checkboxes: Record<string, HTMLInputElement> = {};
  private tuneInputs: Record<TuneKey, HTMLInputElement> = {} as never;
  private tuneValues: Record<TuneKey, HTMLElement> = {} as never;

  constructor(
    root: HTMLElement,
    onToggleFlag: (flag: "axes" | "joints" | "reach" | "raycast", value: boolean) => void,
    private readonly onTune: (key: TuneKey, value: number) => void
  ) {
    root.innerHTML = `
      <div id="debug-panel" class="pointer-events-auto absolute right-4 bottom-4 hidden w-80 rounded-lg border border-zinc-800 bg-zinc-950/85 p-3 font-mono text-[10.5px] leading-relaxed text-zinc-400 backdrop-blur">
        <div class="mb-2 flex items-center justify-between">
          <span class="font-bold text-amber-400">DEBUG (F3)</span>
          <span id="dbg-flags" class="flex gap-2"></span>
        </div>
        <div class="grid grid-cols-2 gap-x-3">
          <div class="col-span-2 mb-1 border-b border-zinc-800 pb-1 text-zinc-500">RENDIMIENTO</div>
          <div>FPS <span id="dbg-fps" class="float-right text-zinc-200">-</span></div>
          <div>Backend <span id="dbg-backend" class="float-right text-zinc-200">-</span></div>
          <div>Fisica <span id="dbg-physics" class="float-right text-zinc-200">-</span></div>
          <div>Cuerpos/Rest <span id="dbg-counts" class="float-right text-zinc-200">-</span></div>
          <div class="col-span-2 mb-1 mt-2 border-b border-zinc-800 pb-1 text-zinc-500">ESTADO</div>
          <div>Maquina <span id="dbg-state" class="float-right text-zinc-200">-</span></div>
          <div>T. juego <span id="dbg-time" class="float-right text-zinc-200">-</span></div>
          <div>COM <span id="dbg-com" class="float-right text-zinc-200">-</span></div>
          <div>Estab. <span id="dbg-stab" class="float-right text-zinc-200">-</span></div>
          <div>Tono <span id="dbg-tone" class="float-right text-zinc-200">-</span></div>
        </div>
        <div class="mt-2 border-t border-zinc-800 pt-1" id="dbg-tune">
          <div class="mb-1 text-zinc-500">BALANCE REALISMO/RAGDOLL</div>
        </div>
        <div class="mt-2 border-t border-zinc-800 pt-1" id="dbg-limbs"></div>
      </div>
    `;
    this.panel = root.querySelector("#debug-panel")!;
    const flagsRoot = root.querySelector("#dbg-flags")!;
    for (const flag of ["axes", "joints", "reach", "raycast"] as const) {
      const label = document.createElement("label");
      label.className = "flex cursor-pointer items-center gap-0.5 text-[9px] text-zinc-500";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "accent-amber-400";
      cb.addEventListener("change", () => onToggleFlag(flag, cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(flag));
      flagsRoot.appendChild(label);
      this.checkboxes[flag] = cb;
    }
    const limbsRoot = root.querySelector("#dbg-limbs")!;
    for (const limb of LIMB_IDS) {
      const row = document.createElement("div");
      row.className = "flex justify-between";
      row.innerHTML = `<span>${limb} <span id="dbg-${limb}-hold" class="text-zinc-600"></span></span><span id="dbg-${limb}" class="text-zinc-200"></span>`;
      limbsRoot.appendChild(row);
      this.rows[limb] = row.querySelector(`#dbg-${limb}`)!;
      this.rows[`${limb}_hold`] = row.querySelector(`#dbg-${limb}-hold`)!;
    }
    // Sliders del balance realismo/ragdoll (ADR-008): calibracion en vivo persistida.
    const tuneRoot = root.querySelector("#dbg-tune")!;
    for (const [key, label, min, max] of [
      ["postureTone", "tono", 0, 1],
      ["jointLimitStiffness", "limites", 0.3, 1],
      ["foldStrength", "pliegue", 0.2, 1],
      ["stretchTolerance", "estirar", 1.02, 1.35]
    ] as const) {
      const wrap = document.createElement("div");
      wrap.className = "flex items-center gap-2";
      const name = document.createElement("span");
      name.className = "w-12 shrink-0";
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = "0.01";
      input.className = "w-full accent-amber-400";
      const val = document.createElement("span");
      val.className = "w-8 shrink-0 text-right text-zinc-200";
      input.addEventListener("input", () => {
        val.textContent = Number(input.value).toFixed(2);
        this.onTune(key, Number(input.value));
      });
      wrap.appendChild(name);
      wrap.appendChild(input);
      wrap.appendChild(val);
      tuneRoot.appendChild(wrap);
      this.tuneInputs[key] = input;
      this.tuneValues[key] = val;
    }
    for (const [id, label] of [
      ["fps", "dbg-fps"],
      ["backend", "dbg-backend"],
      ["physics", "dbg-physics"],
      ["counts", "dbg-counts"],
      ["state", "dbg-state"],
      ["time", "dbg-time"],
      ["com", "dbg-com"],
      ["stab", "dbg-stab"]
    ] as const) {
      this.rows[id] = this.panel.querySelector(`#${label}`)!;
    }
  }

  setFlagCheckbox(flag: string, value: boolean): void {
    const cb = this.checkboxes[flag];
    if (cb) cb.checked = value;
  }

  /** Sincroniza los sliders con los valores persistidos (sin disparar onChange). */
  setTuneValues(values: TuneValues): void {
    for (const key of Object.keys(this.tuneInputs) as TuneKey[]) {
      this.tuneInputs[key].value = String(values[key]);
      this.tuneValues[key].textContent = values[key].toFixed(2);
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.panel.classList.toggle("hidden", !this.visible);
    return this.visible;
  }

  update(data: DebugData): void {
    if (!this.visible) return;
    this.rows["fps"].textContent = String(data.fps);
    this.rows["backend"].textContent = data.backend;
    this.rows["physics"].textContent = `${data.physicsMs.toFixed(2)} ms`;
    this.rows["counts"].textContent = `${data.bodies}/${data.constraints}+${data.anchors}`;
    this.rows["state"].textContent = data.state;
    this.rows["time"].textContent = `${data.gameTime.toFixed(1)} s`;
    this.rows["com"].textContent = `${data.com.x.toFixed(2)}, ${data.com.y.toFixed(2)}`;
    this.rows["stab"].textContent = `${data.stability.toFixed(2)} (${data.supportCount})`;
    this.rows["tone"].textContent = data.tone.toFixed(2);
    for (const limb of LIMB_IDS) {
      const info = data.limbs[limb];
      this.rows[limb].textContent = `${info.state} ${info.zone} r=${info.ratio.toFixed(2)} f=${info.fatigue.toFixed(2)}`;
      this.rows[`${limb}_hold`].textContent = info.holdId ? `@${info.holdId}` : "";
    }
  }
}
