"use client";

/**
 * Lanzador (DECISIONS.md D19): una sola página elige el pack.
 * NO SUELTES (1 jugador, prototipo) o SHERPAS AL LÍMITE (cooperativo local 2).
 */
import { useState } from "react";
import GameMount from "./GameMount";
import SherpaMount from "./SherpaMount";

type Pack = "menu" | "nosueltas" | "sherpas";

const CARDS = [
  {
    id: "sherpas" as const,
    emoji: "⛰️",
    title: "SHERPAS AL LÍMITE",
    desc: "Cooperativo local para 2 jugadores: dos sherpas ragdoll suben al Everest cargando con un ricachón colgado de la cuerda. Anclajes que se rompen, pájaros, insultos y mucha cuerda tensa.",
    tag: "2 jugadores · nuevo",
    accent: "#d97b2f",
  },
  {
    id: "nosueltas" as const,
    emoji: "🧗",
    title: "NO SUELTES",
    desc: "El prototipo original de 1 jugador: física PBD, tensión por extremidad, fatiga, modos realista/equilibrado/ragdoll y repetición épica.",
    tag: "1 jugador · clásico",
    accent: "#2f9bd9",
  },
];

export default function GameLauncher() {
  const [pack, setPack] = useState<Pack>("menu");

  if (pack === "nosueltas") {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-[#0e1116] supports-[100dvh]:h-dvh">
        <button
          onClick={() => setPack("menu")}
          className="absolute left-3 top-3 z-50 rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur transition hover:bg-black/80"
        >
          ← Volver al menú
        </button>
        <GameMount />
      </div>
    );
  }

  if (pack === "sherpas") {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-[#0e1116] supports-[100dvh]:h-dvh">
        <button
          onClick={() => setPack("menu")}
          className="absolute left-3 top-3 z-50 rounded-lg border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur transition hover:bg-black/80"
        >
          ← Volver al menú
        </button>
        <SherpaMount />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0b0f14] px-4 py-10 text-zinc-100 supports-[100dvh]:min-h-dvh">
      <div className="w-full max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-wide">ELIGE TU ASCENSO</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Dos juegos, una misma física creíble. Elige el pack y a escalar.
          </p>
        </header>
        <div className="grid gap-5 sm:grid-cols-2">
          {CARDS.map((c) => (
            <button
              key={c.id}
              onClick={() => setPack(c.id)}
              className="group rounded-2xl border border-white/10 bg-[#10161d] p-6 text-left transition hover:-translate-y-1 hover:border-white/25 hover:bg-[#141c26]"
              style={{ boxShadow: `0 0 0 0 transparent` }}
            >
              <div className="text-4xl">{c.emoji}</div>
              <h2 className="mt-3 text-lg font-bold tracking-wide" style={{ color: c.accent }}>
                {c.title}
              </h2>
              <p className="mt-2 min-h-24 text-[13px] leading-relaxed text-zinc-400">{c.desc}</p>
              <span
                className="mt-3 inline-block rounded-full px-3 py-1 text-[11px] font-semibold"
                style={{ background: `${c.accent}22`, color: c.accent }}
              >
                {c.tag}
              </span>
              <div
                className="mt-4 rounded-lg py-2 text-center text-sm font-bold transition group-hover:brightness-125"
                style={{ background: c.accent, color: "#0b0f14" }}
              >
                JUGAR
              </div>
            </button>
          ))}
        </div>
        <footer className="mt-8 text-center text-[11px] text-zinc-500">
          Teclado recomendado · J1: WASD + 1-4 · J2: Flechas + I/O/K/L (o mando)
        </footer>
      </div>
    </main>
  );
}
