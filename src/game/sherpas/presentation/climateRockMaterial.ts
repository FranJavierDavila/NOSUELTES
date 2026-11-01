// T69 — PLUGIN PBR CLIMÁTICO DE LA PIEDRA (petición del jugador: "mapas y
// texturas PBR triplanares para que no se note la fuga del material en la
// profundidad… quiero que seas imaginativo y me sorprendas con un cambio mucho
// más realista"). Mismo patrón que TriPlanarStrataPlugin (T44): MaterialPlugin-
// Base sobre el PBRMaterial de los chunks, inyección GLSL en el fragment.
//
// Qué añade sobre la capa de estratos (que aporta TONO):
//  · ALBEDO por campos de meteorización (rockClimate.ts, triplanar en espacio
//    mundo — NUNCA se estira en caras oblicuas ni en los faldones): sombra de
//    FISURA (crióclastia), PÁTINA ocre en las cavidades húmedas, LÍQUENES en
//    colonias, BARNIZ Mn-Fe oscuro en las caras estables.
//  · NORMAL: los labios de las fisuras re-perturban normalW (componente
//    tangencial del normal-map climático proyectado sobre la superficie).
//  · CLIMA EN VIVO: wetness (la nieve húmeda oscurece la piedra porosa) y
//    frost (el hielo blanquea las fisuras y endurece el relieve) + ALTITUD:
//    por encima de la cota el índice de ciclos hielo-deshielo sube (más
//    fisuras, menos pátina/barniz).
// La GLOSINOSIDAD va FUERA del plugin: mat.microSurfaceTexture (canal R de
// generateClimateGloss) — Babylon la multiplica a la roughness del material.
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Nullable } from "@babylonjs/core/types";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";

const FRAG_DEFS = `
#ifdef CLIMAROCK
// T69-FIX 3c: los SAMPLERS se declaran AQUÍ (custom code del plugin — vía
// getCustomCode, SIEMPRE inyectada) y NO en getUniforms().fragment: la
// declaración vía manager depende del orden interno de _addPlugin (que
// reconstruye el UBO antes de pushear el plugin) y en la ráfaga de arranque
// compiló sin ella («strataSampler/climaSampler: undeclared identifier»).
uniform sampler2D climaSampler;
uniform sampler2D climaNormalSampler;
vec4 climaTri(vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec4 c = texture2D(climaSampler, p.zy * scale) * w.x;
  c += texture2D(climaSampler, p.xz * scale) * w.y;
  c += texture2D(climaSampler, p.xy * scale) * w.z;
  return c;
}
vec3 climaNormalTri(vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec3 c = texture2D(climaNormalSampler, p.zy * scale).rgb * 2.0 - 1.0;
  vec3 cxz = texture2D(climaNormalSampler, p.xz * scale).rgb * 2.0 - 1.0;
  vec3 cxy = texture2D(climaNormalSampler, p.xy * scale).rgb * 2.0 - 1.0;
  // cada proyección vive en SU marco tangente: rotarla a espacio mundo
  // (xy = plano de proyección, z = eje de la proyección)
  vec3 wxz = vec3(cxz.x, cxz.z, cxz.y);   // plano XZ: tangente (1,0,0), bitangente (0,0,1)
  vec3 wxy = vec3(cxy.x, cxy.y, cxy.z);   // plano XY: tangente (1,0,0), bitangente (0,1,0)
  vec3 wzy = vec3(c.z, c.y, c.x);         // plano ZY: tangente (0,0,1), bitangente (0,1,0)
  return normalize(wzy * w.x + wxz * w.y + wxy * w.z);
}
#endif
`;

const FRAG_MAIN = `
#ifdef CLIMAROCK
vec4 clima = climaTri(vPositionW, geometricNormalW, climaParams.x);
// ALTITUD: sobre la cota fría corren MÁS ciclos hielo-deshielo (crióclastia
// viva) y la química húmeda y el barniz seco se retiran de la zona helada.
float freezeAlt = smoothstep(climaParams.z, climaParams.z + 6.0, vPositionW.y);
float crack = clima.r * (0.8 + 0.6 * freezeAlt);
float patina = clima.g * (1.0 - 0.35 * freezeAlt);
float lich = clima.b * (1.0 - 0.45 * max(geometricNormalW.y, 0.0)) * (1.0 - 0.3 * freezeAlt);
float varnish = clima.a * (1.0 - 0.6 * freezeAlt);
// ALBEDO: pátina ocre (FeOx) + líquenes gris-verde + barniz oscuro + sombra de fisura
vec3 climaTint = vec3(0.0);
climaTint += vec3(0.60, 0.44, 0.26) * patina * 0.40;
climaTint += vec3(0.46, 0.54, 0.38) * lich * 0.42;
climaTint -= vec3(0.34, 0.33, 0.35) * varnish * 0.55;
climaTint -= vec3(0.30, 0.29, 0.30) * crack * 0.55;
// T74: suelo 0.5 → 0.62 — con strength 0.85 el barniz+fisura dejaban la cara
// de la pared a ~×0.5 de albedo y la piedra NO SE LEÍA (petición del jugador:
// «no se ve el muro de piedra»); el carácter climático queda, el aplastado no.
surfaceAlbedo *= clamp(vec3(1.0) + climaTint * climaParams.y, vec3(0.62), vec3(1.30));
// CLIMA EN VIVO: la nieve húmeda oscurece MÁS donde la piedra es porosa
// (fisuras + pátina); el hielo blanquea las fisuras.
float poros = clamp(0.30 + patina * 0.6 + crack * 0.8, 0.0, 1.0);
surfaceAlbedo *= mix(vec3(1.0), vec3(0.78, 0.80, 0.84), climaDyn.x * poros);
surfaceAlbedo = mix(surfaceAlbedo, vec3(0.90, 0.94, 1.00), climaDyn.y * crack * 0.40);
// NORMAL: labios de fisura (componente tangencial del detalle sobre la cara)
vec3 climaN = climaNormalTri(vPositionW, geometricNormalW, climaParams.x);
vec3 climaTangent = climaN - dot(climaN, normalW) * normalW;
normalW = normalize(normalW + climaTangent * climaParams.y * (0.55 + climaDyn.y * 0.30));
#endif
`;

/** Plugin climático triplanar para un PBRMaterial de roca. */
export class ClimateRockPlugin extends MaterialPluginBase {
  private _active = false;
  private _tex: BaseTexture | null = null;
  private _ntex: BaseTexture | null = null;
  private _scale = 0.5;
  private _strength = 0.85;
  private _freezeY = 14;
  // clima en vivo: valores ACTUALES (easing por frame) hacia los objetivos
  private _wetness = 0;
  private _frost = 0;
  private _wetTarget = 0;
  private _frostTarget = 0;
  /** T69-diag: nº de binds recibidos (0 = el material no se ha renderizado). */
  bindCount = 0;

  constructor(material: PBRMaterial) {
    super(material, "ClimateRock", 225, { CLIMAROCK: false }, true, false, false);
    // T69-FIX 2: los uniforms NO viajan por el bus de eventos del plugin manager
    // (bindForSubMesh del plugin solo corre bajo mustRebind y con efectos
    // estables puede no correr NUNCA — diagnosticado por sonda: 88 binds del
    // material y 0 del plugin; también la vía hardBind quedó sin dispararse).
    // El canal que MANDA es syncNow(), llamado por SherpaScene.render() cada
    // frame (canal propio del juego, demostrado que corre).
  }

  /** Texturas (campos + normal, tileables) y parámetros de mapeado. */
  configure(tex: BaseTexture | null, ntex: BaseTexture | null, scale: number, strength: number, freezeY: number): void {
    this._tex = tex;
    this._ntex = ntex;
    this._scale = Math.max(0.05, scale);
    this._strength = Math.min(1.5, Math.max(0, strength));
    this._freezeY = freezeY;
    this._active = !!tex && !!ntex;
    // T69-FIX: la ACTIVACIÓN es un cambio de estado que se comunica AL MOMENTO
    // (patrón oficial Babylon — clearcoat llama _enable desde su setter): sin
    // _enable el manager no mete el plugin en _activePlugins, prepareDefines
    // jamás corre y el código custom se compila FUERA (capa muerta en silencio:
    // diagnosticado por sonda — _activePlugins solo contenía PBRBRDF).
    this._enable(this._active && this._material.shaderLanguage === ShaderLanguage.GLSL);
    this.markAllDefinesAsDirty();
  }

  /** Objetivos de clima en vivo (setSnowVisual): 0..1. El easing ocurre en el bind. */
  setDynamics(wetness: number, frost: number): void {
    this._wetTarget = Math.min(1, Math.max(0, wetness));
    this._frostTarget = Math.min(1, Math.max(0, frost));
  }

  /** Cota fría actual (setSnowVisual): por encima corren más ciclos hielo-deshielo. */
  setFreezeY(y: number): void {
    if (Number.isFinite(y)) this._freezeY = Math.max(0, y);
  }

  /** Cota fría vigente (sonda E2E). */
  get freezeY(): number {
    return this._freezeY;
  }

  /** Estado actual (sonda E2E). */
  get dynamics(): { wetness: number; frost: number; targetWet: number; targetFrost: number; binds: number } {
    return {
      wetness: Math.round(this._wetness * 1000) / 1000,
      frost: Math.round(this._frost * 1000) / 1000,
      targetWet: Math.round(this._wetTarget * 1000) / 1000,
      targetFrost: Math.round(this._frostTarget * 1000) / 1000,
      binds: this.bindCount,
    };
  }

  prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    // WGSL (WebGPU): el código del plugin es GLSL — desactivado en ese backend.
    // (La ACTIVACIÓN vive en configure(): aquí solo se publica el define —
    // prepareDefines solo corre cuando el plugin ya está en _activePlugins.)
    defines.CLIMAROCK = this._active && this._material.shaderLanguage === ShaderLanguage.GLSL;
  }

  isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): boolean {
    if (!_defines.CLIMAROCK) return true;
    return !!this._tex && this._tex.isReady() && !!this._ntex && this._ntex.isReady();
  }

  getSamplers(samplers: string[]): void {
    samplers.push("climaSampler", "climaNormalSampler");
  }

  getUniforms(): { ubo: { name: string; size: number; type: string }[] } {
    return {
      ubo: [
        { name: "climaParams", size: 4, type: "vec4" },
        { name: "climaDyn", size: 4, type: "vec4" },
      ],
      // los samplers van en FRAG_DEFS (ver arriba): duplicarlos aquí haría
      // una redeclaración GLSL cuando AMBAS vías llegan al shader
    };
  }

  getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    if ((shaderLanguage ?? this._material.shaderLanguage) !== ShaderLanguage.GLSL) return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FRAG_DEFS,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: FRAG_MAIN,
    };
  }

  /** hardBindForSubMesh (vía oficial Babylon si el manager la dispara). */
  hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene): void {
    this.writeUniforms(uniformBuffer);
  }

  /** T69 — CANAL REAL: escribe los uniforms AHORA en el UBO del material. Lo
   *  llama SherpaScene.render() cada frame (el easing del clima vive aquí). */
  syncNow(): void {
    if (!this._active) return;
    const ubo = (this._material as PBRMaterial & { _uniformBuffer?: UniformBuffer })._uniformBuffer;
    if (ubo) this.writeUniforms(ubo);
  }

  private writeUniforms(uniformBuffer: UniformBuffer): void {
    if (!this._active) return;
    // T69-FIX 3b: hasta que el REBUILD del UBO registró los uniforms del
    // plugin (_uniformLocations poblados), escribir lanzaría «Cannot add an
    // uniform after UBO has been created» y ensuciaría la consola. El salto
    // es silencioso: el primer bind del material pinta ya con valores.
    const locs = (uniformBuffer as unknown as { _uniformLocations?: Record<string, number> })._uniformLocations;
    if (!locs || !("climaParams" in locs)) return;
    this.bindCount++;
    // easing del clima en vivo (~1 s de rampa a 60 fps, exponencial)
    const k = 0.045;
    this._wetness += (this._wetTarget - this._wetness) * k;
    this._frost += (this._frostTarget - this._frost) * k;
    // syncNow corre ANTES del primer bind del material: hasta que el UBO tiene
    // layout (primer bind del material, vía mustRebind del primer frame) las
    // escrituras no existen aún — se toleran y a partir de ese momento viajan.
    try {
      uniformBuffer.updateFloat4("climaParams", this._scale, this._strength, this._freezeY, 0);
      uniformBuffer.updateFloat4("climaDyn", this._wetness, this._frost, 0, 0);
      if (this._tex && this._ntex) {
        uniformBuffer.setTexture("climaSampler", this._tex);
        uniformBuffer.setTexture("climaNormalSampler", this._ntex);
      }
    } catch {
      /* UBO aún sin layout: el primer bind del material lo crea */
    }
  }

  override dispose(force?: boolean): void {
    // NOTA: las texturas climáticas son COMPARTIDAS por todos los chunks (una
    // sola pareja por escena) — su ciclo de vida lo gestiona SherpaScene, NUNCA
    // la disposal del material (un chunk LRU no puede matar la capa).
    this._tex = null;
    this._ntex = null;
    super.dispose(force);
  }
}
