import GameMount from "@/components/game/GameMount";

export default function Home() {
  return (
    <main className="h-screen w-full overflow-hidden bg-[#0e1116] supports-[height:100dvh]:h-dvh">
      <GameMount />
    </main>
  );
}
