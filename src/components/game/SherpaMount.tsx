"use client";

/**
 * Monte de SHERPAS AL LÍMITE: canvas + capas HUD y arranque en el cliente.
 * Babylon y los datos se importan dinámicamente para evitar SSR.
 */
import { useEffect, useRef } from "react";

export default function SherpaMount() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let handles: { dispose(): void } | null = null;

    const boot = async (): Promise<void> => {
      const canvas = canvasRef.current;
      const hudRoot = hudRef.current;
      if (!canvas || !hudRoot) return;
      const { bootstrapSherpasGame } = await import("@/game/sherpas/mount");
      if (disposed) return;
      handles = await bootstrapSherpasGame({ canvas, hudRoot });
    };

    void boot().catch((err) => {
      console.error("Fallo al arrancar Sherpas al Límite", err);
      if (hudRef.current) {
        hudRef.current.innerHTML = `
          <div class="absolute inset-0 flex items-center justify-center p-8">
            <div class="max-w-md rounded-xl border border-red-900/60 bg-zinc-950/90 p-6 text-sm text-red-300">
              <div class="text-lg font-bold">No se pudo iniciar la ascensión</div>
              <div class="mt-2 font-mono text-xs text-red-400/80">${String(err instanceof Error ? err.message : err)}</div>
              <div class="mt-3 text-zinc-400">Comprueba la consola del navegador y recarga la página.</div>
            </div>
          </div>
        `;
      }
    });

    return () => {
      disposed = true;
      handles?.dispose();
    };
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#0e1116] supports-[100dvh]:h-dvh">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none outline-none" />
      <div ref={hudRef} className="pointer-events-none absolute inset-0" />
    </div>
  );
}
