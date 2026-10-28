// T40-AUDIO — REGENERACIÓN DEL BANCO ES DEL RICACHÓN EN CASTELLANO PROPERO.
// Petición del jugador: "Los audios que has puesto no están en castellano y
// son de voz ruda, fuerte masculina". Diagnóstico: el banco usaba la voz
// "luodo" (timbre fuerte masculino, fonética no castellana) a volumen 3.2-5
// (distorsión). A/B verificado con ASR: "tongtong" es la voz que MEJOR
// pronuncia castellano (timbre cálido) — se regenera TODO el banco es + el
// grito "¡¡CABRONEEEEESSSS!!!!" a volumen moderado (sin distorsión).
// El banco EN no se toca (juego en inglés). Re-ejecutable.
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "public/content/sherpas";
const OUT = "public/audio/rico";

function ricoSlug(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const VOICE = "tongtong";   // A/B con ASR: la que mejor pronuncia castellano
const SPEED = 1.05;         // burlón ligero
const VOLUME = 1.8;         // nítido SIN distorsión (antes 3.2-5 = "rudo")
const GAP_MS = 1400;
const RETRIES = 5;
const CALL_TIMEOUT_MS = 30000;

process.on("unhandledRejection", (e) => {
  console.error(`(rechazo SDK ignorado: ${String(e).slice(0, 120)})`);
});

async function genOne(zai, text, path) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await Promise.race([
        zai.audio.tts.create({
          input: text, voice: VOICE, speed: SPEED, volume: VOLUME,
          response_format: "wav", stream: false,
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("call timeout 30s")), CALL_TIMEOUT_MS)),
      ]);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      if (buffer.length < 800) throw new Error(`buffer corto (${buffer.length}B)`);
      writeFileSync(path, buffer);
      return true;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (attempt === RETRIES) {
        console.error(`FALLO [${path}]: ${msg}`);
        return false;
      }
      const waitS = msg.includes("429") ? 25 + attempt * 20 : 3 + attempt * 4;
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  return false;
}

async function main() {
  const zai = await ZAI.create();
  // 1) banco de insultos es
  const bank = JSON.parse(readFileSync(join(BASE, "insults_es.json"), "utf8"));
  const dir = join(OUT, "es");
  mkdirSync(dir, { recursive: true });
  const jobs = [];
  let skip = 0;
  for (const lines of Object.values(bank)) {
    for (const text of lines) {
      const file = join(dir, `${ricoSlug(text)}.mp3`);
      if (existsSync(file) && statSync(file).size > 800 && isNew(file)) { skip++; continue; }
      jobs.push({ text, file });
    }
  }
  // (T40) el GRITO fijo NO se regenera: cd0e9f33.mp3 es la GRABACIÓN REAL
  // del jugador (Task 38, ffmpeg loudnorm) — el TTS no la toca.
  console.log(`[es] ${jobs.length} por generar (${skip} recién generadas se saltan)`);
  let ok = 0, fail = 0;
  for (const job of jobs) {
    const done = await genOne(zai, job.say ?? job.text, job.file);
    if (done) { ok++; process.stdout.write("."); } else fail++;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  process.stdout.write("\n");
  console.log(`LISTO es: ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

// marca de frescura: los ficheros generados HOY por esta pasada llevan tag
// (simple: si el fichero existe Y es más nuevo que el arranque del script → skip)
const T0 = Date.now();
function isNew(f) {
  try { return statSync(f).mtimeMs > T0 - 2000; } catch { return false; }
}

main().catch((e) => { console.error(e); process.exit(1); });
