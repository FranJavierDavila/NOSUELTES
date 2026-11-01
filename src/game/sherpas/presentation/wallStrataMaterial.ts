// T44 — PLUGIN PBR DE ESTRATOS TRIPANAR (petición del jugador: "usar un
// mapeado triplanar para mapear en todos los ejes y evitar las fugas").
//
// MaterialPluginBase sobre PBRMaterial: muestrea la textura de estratos
// (strataTexture.ts) en ESPACIO MUNDO con mezcla de 3 proyecciones ponderadas
// por la normal geométrica — la textura NUNCA se estira en caras oblicuas
// (la "fuga" del mapeado plano) y el patrón queda continuo en toda la pared.
//
// Puntos de inyección del fragment PBR:
//  · CUSTOM_FRAGMENT_DEFINITIONS  → función de muestreo triplanar
//  · CUSTOM_FRAGMENT_BEFORE_LIGHTS → multiplica surfaceAlbedo (después del
//    albedo horneado, antes de AO/iluminación — el PBR hace el resto).
// El detalle fino vive en el normalMap horneado (bumpTexture del material);
// esta capa aporta RIQUEZA DE TONO, no geometría.
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
#ifdef TRISTATA
// T69-FIX 3c: el SAMPLER se declara AQUÍ (custom code — vía getCustomCode,
// SIEMPRE inyectada) y NO en getUniforms().fragment (ver ClimateRock).
uniform sampler2D strataSampler;
vec3 strataTri(vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec3 c = texture2D(strataSampler, p.zy * scale).rgb * w.x;
  c += texture2D(strataSampler, p.xz * scale).rgb * w.y;
  c += texture2D(strataSampler, p.xy * scale).rgb * w.z;
  return c;
}
#endif
`;

const FRAG_MAIN = `
#ifdef TRISTATA
// T75: SUELO del tono — una lectura fallida del sampler (driver/GPU concreto,
// unidad sin textura) devolvía NEGRO y el mix aplastaba el albedo horneado a
// ~×0.2 PLANO (la cara entera gris oscuro, «no se ve el muro de piedra»).
// Con el suelo 0.55 (×2 = 1.1 ≈ neutro) una lectura muerta degrada a casi
// sin efecto en vez de teñir de negro; una lectura sana no se toca (el centro
// de la textura es 0.5 → 1.0 y las bandas profundas quedan a 0.27→0.55).
vec3 sCol = max(strataTri(vPositionW, geometricNormalW, strataParams.x) * 2.0, vec3(0.55));
surfaceAlbedo *= mix(vec3(1.0), sCol, strataParams.y);
// T55 — GRANO/DETALLE: segunda muestra TRIPANAR a escala fina (misma textura,
// espacio mundo multiplicado) — rompe la planicie de tono de la escala media.
if (strataParams.z > 0.001) {
  vec3 dCol = max(strataTri(vPositionW * strataParams.w + vec3(7.31, 3.17, 11.7), geometricNormalW, strataParams.x) * 2.0, vec3(0.55));
  surfaceAlbedo *= mix(vec3(1.0), dCol, strataParams.z);
}
#endif
`;

/** Plugin de estratos triplanar para un PBRMaterial de la pared. */
export class TriPlanarStrataPlugin extends MaterialPluginBase {
  private _active = false;
  private _tex: BaseTexture | null = null;
  private _scale = 0.72;
  private _strength = 0.5;
  private _detail = 0; // T55: fuerza del grano fino (0 = desactivado)
  private _detailScaleMul = 6.3; // multiplicador de escala del grano

  constructor(material: PBRMaterial) {
    super(material, "TriPlanarStrata", 220, { TRISTATA: false }, true, false, false);
    // T69-FIX 2 (ver ClimateRock): los uniforms NO dependen del bus del manager
    // — el canal real es syncNow(), llamado por SherpaScene.render() cada frame.
  }

  /** Textura de estratos (tileable, RGBA) + parámetros de mapeado. */
  configure(tex: BaseTexture | null, scale: number, strength: number, detail = 0, detailScaleMul = 6.3): void {
    this._tex = tex;
    this._scale = Math.max(0.05, scale);
    this._strength = Math.min(1, Math.max(0, strength));
    this._detail = Math.min(0.5, Math.max(0, detail));
    this._detailScaleMul = Math.max(1.5, detailScaleMul);
    this._active = !!tex;
    // T69-FIX: la ACTIVACIÓN se comunica AL MOMENTO (patrón oficial Babylon —
    // el clearcoat llama _enable desde su setter): sin _enable el manager no
    // mete el plugin en _activePlugins, prepareDefines JAMÁS corre y el código
    // custom se compila fuera. Diagnosticado por sonda en el navegador: el
    // material de roca tenía _activePlugins = [PBRBRDF] y esta capa llevaba
    // tiempo muerta en silencio.
    this._enable(this._active && this._material.shaderLanguage === ShaderLanguage.GLSL);
    this.markAllDefinesAsDirty();
  }

  prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    // WGSL (WebGPU): el código del plugin es GLSL — desactivado en ese backend
    // (la escena arranca WebGL2 primero; el fallback WebGPU pierde solo la capa).
    // (La ACTIVACIÓN vive en configure(): aquí solo se publica el define.)
    defines.TRISTATA = this._active && this._material.shaderLanguage === ShaderLanguage.GLSL;
  }

  isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): boolean {
    if (!_defines.TRISTATA) return true;
    return !!this._tex && this._tex.isReady();
  }

  getSamplers(samplers: string[]): void {
    samplers.push("strataSampler");
  }

  getUniforms(): { ubo: { name: string; size: number; type: string }[] } {
    return {
      ubo: [{ name: "strataParams", size: 4, type: "vec4" }],
      // el sampler va en FRAG_DEFS (custom code, vía getCustomCode): la vía
      // getUniforms().fragment dependía del orden de _addPlugin y en la
      // ráfaga de arranque compiló sin ella (T69-FIX 3c)
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
  hardBindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene): void {
    this.writeUniforms(uniformBuffer, scene);
  }

  /** T69 — CANAL REAL: escribe los uniforms AHORA en el UBO del material. */
  syncNow(): void {
    if (!this._active) return;
    const ubo = (this._material as PBRMaterial & { _uniformBuffer?: UniformBuffer })._uniformBuffer;
    if (ubo) this.writeUniforms(ubo, this._material.getScene());
  }

  private writeUniforms(uniformBuffer: UniformBuffer, scene: Scene): void {
    if (!this._active || !this._tex) return;
    // T69-FIX 3b: hasta que el REBUILD del UBO registró strataParams en el
    // layout (_uniformLocations), escribir lanzaría «Cannot add an uniform
    // after UBO has been created» y ensuciaría la consola. Salto silencioso:
    // el primer bind del material pinta ya con valores.
    const locs = (uniformBuffer as unknown as { _uniformLocations?: Record<string, number> })._uniformLocations;
    if (!locs || !("strataParams" in locs)) return;
    try {
      uniformBuffer.updateFloat4("strataParams", this._scale, this._strength, this._detail, this._detailScaleMul);
      if (scene.texturesEnabled) {
        uniformBuffer.setTexture("strataSampler", this._tex);
      }
    } catch {
      /* UBO aún sin layout: el primer bind del material lo crea */
    }
  }

  override dispose(force?: boolean): void {
    // NOTA: la textura de estratos es COMPARTIDA por todos los chunks de la
    // pared (una sola por escena) — su ciclo de vida lo gestiona SherpaScene,
    // NUNCA la disposal del material (un chunk LRU no puede matar la capa).
    this._tex = null;
    super.dispose(force);
  }
}
