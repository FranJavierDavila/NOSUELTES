/**
 * Bootstrap del prototipo NO SUELTES.
 * Carga, valida e instancia todo desde datos (ContentRepository) y devuelve un
 * identificador desechable para la integracion con Next.js.
 */
import { GameApp, type GameAppOptions } from "./app/loop";

export interface GameHandles {
  /** Reinicio manual (equivale a la tecla R). */
  reset(): void;
  dispose(): void;
}

export async function bootstrapGame(opts: GameAppOptions): Promise<GameHandles> {
  // StrictMode/HMR pueden montar dos veces: garantiza una UNICA instancia viva.
  const w = window as unknown as { __NS_APP?: { dispose(): void } };
  if (w.__NS_APP) {
    try {
      w.__NS_APP.dispose();
    } catch {
      /* la instancia previa ya no existe */
    }
    w.__NS_APP = undefined;
  }
  const app = await GameApp.create(opts, () => undefined);
  w.__NS_APP = app;
  (window as unknown as { __NS?: unknown }).__NS = app.debugHook;
  return {
    reset: () => app.requestReset(),
    dispose: () => app.dispose()
  };
}
