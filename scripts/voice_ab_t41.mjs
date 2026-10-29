// T41-AUDIO — A/B DE VOCES GRAVES MASCULINAS PARA EL CASTELLANO DEL RICACHÓN.
// Petición del jugador: "hombre curtido, voz fuerte y grave, ruda, déspota,
// abusona e insultona que dice muchos tacos" y "las voces en inglés" (el banco
// tongtong T40 suena a inglés/charlatán). Candidatos con timbre MASCULINO
// grave: xiaochen (profesional sereno), jam (caballero británico), luodo
// (expresivo), kazi (estándar) + tongtong de CONTROL. Verificación ASR: la voz
// elegida debe PRESERVAR las palabras castellanas (los tacos incluidos).
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/voice-ab-t41";
mkdirSync(OUT, { recursive: true });

const PHRASES = [
  "¡Hostia, joder, que resbalo! ¡Esto me lo pagas tú, cabrón!",
  "¡Joder, muévete, gilipollas, que el tiempo es dinero!",
];
const VOICES = ["xiaochen", "jam", "luodo", "kazi", "tongtong"];
const SPEED = 1.0;
const VOLUME = 2.0;

process.on("unhandledRejection", (e) => {
  console.error(`(rechazo SDK ignorado: ${String(e).slice(0, 120)})`);
});

async function main() {
  const zai = await ZAI.create();
  for (const voice of VOICES) {
    for (let i = 0; i < PHRASES.length; i++) {
      const file = join(OUT, `${voice}_${i}.wav`);
      let ok = false;
      for (let a = 0; a < 4 && !ok; a++) {
        try {
          const response = await Promise.race([
            zai.audio.tts.create({
              input: PHRASES[i], voice, speed: SPEED, volume: VOLUME,
              response_format: "wav", stream: false,
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 30s")), 30000)),
          ]);
          const buf = Buffer.from(new Uint8Array(await response.arrayBuffer()));
          if (buf.length < 800) throw new Error(`buffer corto ${buf.length}B`);
          writeFileSync(file, buf);
          console.log(`TTS OK ${voice} [${i}] (${buf.length}B)`);
          ok = true;
        } catch (e) {
          const msg = String(e?.message ?? e);
          if (a === 3) console.error(`FALLO ${voice} [${i}]: ${msg.slice(0, 100)}`);
          else await new Promise((r) => setTimeout(r, msg.includes("429") ? 25000 : 4000));
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  console.log("LISTO A/B (ver ASR con scripts/voice_ab_asr_t41.mjs)");
}
main().catch((e) => { console.error(e); process.exit(1); });
