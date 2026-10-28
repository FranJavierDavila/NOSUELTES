// T40-AUDIO A/B de voces: genera 2 frases castellanas con varias voces y las
// verifica con ASR (transcripción) — elegimos la voz que pronuncia MEJOR el
// castellano (y con timbre no "rudo fuerte masculino": descartamos luodo).
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/voice-ab";
mkdirSync(OUT, { recursive: true });

const PHRASES = [
  "¡Os pago por subir, no por resbalar!",
  "¡Cabroneeesss!",
];
const VOICES = ["tongtong", "chuichui", "douji", "xiaochen", "kazi"];

async function main() {
  const zai = await ZAI.create();
  for (const voice of VOICES) {
    for (let i = 0; i < PHRASES.length; i++) {
      const file = join(OUT, `${voice}_${i}.wav`);
      try {
        const response = await zai.audio.tts.create({
          input: PHRASES[i], voice, speed: 1.05, volume: 1.6,
          response_format: "wav", stream: false,
        });
        const buf = Buffer.from(new Uint8Array(await response.arrayBuffer()));
        if (buf.length < 800) throw new Error(`buffer corto ${buf.length}B`);
        writeFileSync(file, buf);
        console.log(`TTS OK ${voice} [${i}] (${buf.length}B)`);
      } catch (e) {
        console.error(`TTS FALLO ${voice} [${i}]: ${String(e?.message ?? e).slice(0, 100)}`);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  // verificación ASR
  console.log("\n=== VERIFICACIÓN ASR ===");
  for (const voice of VOICES) {
    for (let i = 0; i < PHRASES.length; i++) {
      const file = join(OUT, `${voice}_${i}.wav`);
      try {
        const b64 = readFileSync(file).toString("base64");
        const r = await zai.audio.asr.create({ file_base64: b64 });
        console.log(`ASR ${voice} [${i}]: "${(r.text || "").trim()}"  (esperado: "${PHRASES[i]}")`);
      } catch (e) {
        console.error(`ASR FALLO ${voice} [${i}]: ${String(e?.message ?? e).slice(0, 100)}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
