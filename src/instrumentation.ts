// T60: arranque del servicio de salas del juego remoto junto al servidor Next.
// `register()` corre al boot del server (dev y standalone). Lanzamos el mini
// servicio de socket.io (:3003) como hijo del propio servidor — así vive en la
// misma cadena supervisada y sobrevive al ciclo del sandbox. Si ya hay una
// instancia en :3003, el servicio sale callado (guarda EADDRINUSE).
// Los require van por eval() para que el bundler de la ruta EDGE no intente
// resolver módulos de node (solo corren en runtime nodejs).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __NS_NET_BOOTED?: boolean };
  if (g.__NS_NET_BOOTED) return;
  g.__NS_NET_BOOTED = true;
  try {
    const req = eval("require") as (m: string) => Record<string, unknown>;
    const { spawn } = req("node:child_process") as typeof import("node:child_process");
    const path = req("node:path") as typeof import("node:path");
    const cwd = process.cwd();
    const child = spawn("bun", [path.join(cwd, "mini-services/sherpas-net/index.ts")], {
      cwd,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env,
    });
    child.on("error", () => { /* sin bun en el entorno: el juego local sigue OK */ });
    child.unref();
  } catch {
    // nunca bloquear el arranque del juego por el servicio de red
  }
}
