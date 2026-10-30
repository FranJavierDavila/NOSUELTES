// T55 — PLUGIN PBR DE VIENTO EN LA VEGETACIÓN ("las plantas que aparecen
// podrían reaccionar con el viento"). MaterialPluginBase sobre el PBRMaterial
// compartido de las matas: desplaza los VÉRTICES de cada hoja en el VERTEX
// shader usando el atributo por vértice `plantBend` (x = factor de doblado
// 0 base → 1 punta, y = fase de la mata — plantas.ts). CERO coste de CPU por
// planta y sin tocar la física: el balanceo es cosmético.
//
// Modelo del movimiento (todo en espacio LOCAL = MUNDO: las mallas de matas
// nacen con coordenadas mundo y matriz identidad):
//  · BRISA (siempre, level≈0): oscilación senoidal pequeña por mata con fase y
//    frecuencia propias — la pared nunca está muerta.
//  · RACHA (level 0..1+): amplitud crece y se añade un EMPUJE NETO cuadrático
//    en la dirección del viento (las hojas quedan ladeadas mientras dura).
//  · La hoja se AGACHA al doblar (Δy negativo ∝ |sway|) y aletea un poco en z.
//
// Puntos de inyección del vertex PBR:
//  · CUSTOM_VERTEX_DEFINITIONS      → atributo + uniforms
//  · CUSTOM_VERTEX_UPDATE_POSITION  → desplazamiento de `position`
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Nullable } from "@babylonjs/core/types";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";

const VERT_DEFS = `
#ifdef PLANTWIND
attribute vec2 plantBend;
uniform vec4 plantWindParams; // x: level, y: time(s), z: breezeAmp(m), w: swayFreq(rad/s)
uniform vec4 plantWindDir;    // x: dir(+1/-1), y: dipK, z: pushM, w: flutterK
#endif
`;

const VERT_MAIN = `
#ifdef PLANTWIND
  float pwLvl = max(0.0, plantWindParams.x);
  float pwB = plantBend.x * plantBend.x; // doblado cuadrático: base quieta, punta toda
  float pwPh = plantBend.y * 6.2831853;
  float pwAmp = plantWindParams.z * pwB * (0.4 + 1.1 * pwLvl);
  float pwFreq = plantWindParams.w * (0.8 + 0.5 * fract(plantBend.y * 7.31));
  float pwSway = sin(plantWindParams.y * pwFreq + pwPh) * pwAmp
               + pwLvl * pwLvl * plantWindDir.z * pwB; // empuje neto en racha
  position.x += pwSway * plantWindDir.x;
  position.z += sin(plantWindParams.y * pwFreq * 1.37 + pwPh * 1.7) * pwAmp * plantWindDir.w;
  position.y -= abs(pwSway) * plantWindDir.y * pwB; // se agacha al doblar
#endif
`;

/** Config data-driven (wall_gen.relief.vegetacion.viento). */
export interface PlantWindCfg {
  breezeAmpM: number; // amplitud de brisa en la punta (m)
  swayFreq: number; // frecuencia del balanceo (rad/s)
  pushM: number; // empuje neto en la punta con level=1 (m)
  dipK: number; // cuánto se agacha al doblar (fracción del sway)
  flutterK: number; // aleteo en z (fracción de la amplitud)
}

export const PLANT_WIND_DEFAULTS: PlantWindCfg = {
  breezeAmpM: 0.022,
  swayFreq: 2.3,
  pushM: 0.055,
  dipK: 0.25,
  flutterK: 0.4,
};

const num = (v: unknown, def: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

export function resolvePlantWindCfg(raw: unknown): PlantWindCfg {
  const r = (raw ?? null) as Partial<Record<keyof PlantWindCfg, unknown>> | null;
  const d = PLANT_WIND_DEFAULTS;
  return {
    breezeAmpM: num(r?.breezeAmpM, d.breezeAmpM, 0, 0.12),
    swayFreq: num(r?.swayFreq, d.swayFreq, 0.3, 8),
    pushM: num(r?.pushM, d.pushM, 0, 0.3),
    dipK: num(r?.dipK, d.dipK, 0, 1),
    flutterK: num(r?.flutterK, d.flutterK, 0, 1.5),
  };
}

/** Plugin de viento para el PBRMaterial de la vegetación (UNO por escena). */
export class PlantWindPlugin extends MaterialPluginBase {
  private _active = false;
  private _level = 0;
  private _dir: 1 | -1 = 1;
  private _cfg: PlantWindCfg = PLANT_WIND_DEFAULTS;
  private _time = 0; // reloj propio (dt del engine): sin depender de APIs de escena

  constructor(material: PBRMaterial) {
    super(material, "PlantWind", 240, { PLANTWIND: false }, true, false, false);
  }

  /** Activa el plugin con su config (activo = hay mallas de matas con bend). */
  configure(cfg: PlantWindCfg): void {
    this._cfg = cfg;
    this._active = true;
    this.markAllDefinesAsDirty();
  }

  /** Estado del viento (lo llama SherpaScene.setWind cada tick de racha). */
  setWindState(dir: number, level: number): void {
    this._dir = (Math.sign(dir) || 1) as 1 | -1;
    this._level = Math.max(0, level);
  }

  prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    // GLSL-only: el código del plugin está en GLSL (ver wallStrataMaterial).
    defines.PLANTWIND = this._active && this._material.shaderLanguage === ShaderLanguage.GLSL;
  }

  isReadyForSubMesh(): boolean {
    return true; // sin texturas que esperar
  }

  /** Atributo por vértice (la malla lleva un VertexBuffer "plantBend"). */
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    if (this._active && this._material.shaderLanguage === ShaderLanguage.GLSL) {
      attributes.push("plantBend");
    }
  }

  getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [
        { name: "plantWindParams", size: 4, type: "vec4" },
        { name: "plantWindDir", size: 4, type: "vec4" },
      ],
      vertex: "",
    };
  }

  getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "vertex") return null;
    if ((shaderLanguage ?? this._material.shaderLanguage) !== ShaderLanguage.GLSL) return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: VERT_DEFS,
      CUSTOM_VERTEX_UPDATE_POSITION: VERT_MAIN,
    };
  }

  bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene): void {
    if (!this._active) return;
    this._time += scene.getEngine().getDeltaTime() / 1000; // ms → s
    uniformBuffer.updateFloat4("plantWindParams", this._level, this._time, this._cfg.breezeAmpM, this._cfg.swayFreq);
    uniformBuffer.updateFloat4("plantWindDir", this._dir, this._cfg.dipK, this._cfg.pushM, this._cfg.flutterK);
  }

  /** Sonda E2E: estado vivo del plugin. */
  debugInfo(): { active: boolean; level: number; dir: number; breezeAmpM: number; swayFreq: number; pushM: number } {
    return {
      active: this._active,
      level: Math.round(this._level * 1000) / 1000,
      dir: this._dir,
      breezeAmpM: this._cfg.breezeAmpM,
      swayFreq: this._cfg.swayFreq,
      pushM: this._cfg.pushM,
    };
  }
}
