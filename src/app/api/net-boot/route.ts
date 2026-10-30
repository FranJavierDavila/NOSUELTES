// T60: encendido manual del servicio de salas (hijo del next-server → misma
// cadena supervisada que postcss, sobrevive al ciclo del sandbox). La
// instrumentation.ts lo arranca sola en el próximo boot del servidor; esta
// ruta cubre el servidor YA arrancado. Idempotente: si :3003 responde, no toca nada.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const g = globalThis as unknown as { __NS_NET_BOOTING?: boolean };
  if (g.__NS_NET_BOOTING) return NextResponse.json({ ok: true, already: "booting" });
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 900);
    const res = await fetch("http://127.0.0.1:3003/?EIO=4&transport=polling", {
      signal: ctl.signal,
    }).finally(() => clearTimeout(t));
    await res.text();
    return NextResponse.json({ ok: true, already: "up" });
  } catch {
    g.__NS_NET_BOOTING = true;
    try {
      const { spawn } = await import("node:child_process");
      const path = await import("node:path");
      const cwd = process.cwd();
      spawn("bun", [path.join(cwd, "mini-services/sherpas-net/index.ts")], {
        cwd,
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: process.env,
      }).unref();
      // darle un momento y comprobar
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 900);
        const res = await fetch("http://127.0.0.1:3003/?EIO=4&transport=polling", {
          signal: ctl.signal,
        }).finally(() => clearTimeout(t));
        await res.text();
        return NextResponse.json({ ok: true, booted: true });
      } catch {
        return NextResponse.json({ ok: false, error: "no-subio" }, { status: 502 });
      }
    } finally {
      g.__NS_NET_BOOTING = false;
    }
  }
}
