// T40-AUDIO: ASR del resto de muestras (rate limit: pausas largas)
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/voice-ab";
const JOBS = [
  ["tongtong", 1], ["xiaochen", 0], ["xiaochen", 1], ["kazi", 0], ["kazi", 1],
];
const ESPERADO = ["¡Os pago por subir, no por resbalar!", "¡Cabroneeesss!"];

async function main() {
  const zai = await ZAI.create();
  for (const [voice, i] of JOBS) {
    const file = join(OUT, `${voice}_${i}.wav`);
    if (!existsSync(file)) { console.log(`(no existe ${file})`); continue; }
    let done = false;
    for (let a = 0; a < 3 && !done; a++) {
      try {
        const b64 = readFileSync(file).toString("base64");
        const r = await zai.audio.asr.create({ file_base64: b64 });
        console.log(`ASR ${voice} [${i}]: "${(r.text || "").trim()}"  (esperado: "${ESPERADO[i]}")`);
        done = true;
      } catch (e) {
        const m = String(e?.message ?? e).slice(0, 80);
        if (a === 2) console.error(`ASR FALLO ${voice} [${i}]: ${m}`);
        else await new Promise((r) => setTimeout(r, 15000));
      }
    }
    await new Promise((r) => setTimeout(r, 6000));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
