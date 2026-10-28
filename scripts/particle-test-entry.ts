// Banco de pruebas de partículas — MISMA versión de Babylon que el juego.
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Materials/standardMaterial";

(window as unknown as { __pt: unknown }).__pt = {
  Engine, Scene, FreeCamera, ParticleSystem, DynamicTexture, Color4, Vector3,
};
