// T41-AUDIO — REGENERACIÓN COMPLETA DEL BANCO ES DEL RICACHÓN.
// Petición del jugador: "Las voces en inglés, de un hombre curtido y de voz
// fuerte y grave, ruda, déspota, abusona e insultona que dice muchos tacos".
// Diagnóstico T40: tongtong (169 Hz, timbre agudo) DESTROYE el castellano
// (ASR control: 0-2/5 palabras) — suena a charlatán inglés. Elección T41
// (A/B + F0 + ASR): xiaochen = 94 Hz (voz MASCULINA GRAVE), mejor
// preservación de palabras castellanas (4/10 vs 2/10). Post-proceso ffmpeg:
// pitch-down 0,90 (→ ~84 Hz, grava curtida) + graves + compresor (presencia
// despótica) + loudnorm. PROTEGIDO: el grito real cd0e9f33.mp3 NO se toca.
// Re-ejecutable (salta lo recién generado).
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE = "public/content/sherpas";
const OUT = "public/audio/rico/es";
const BACKUP = "scripts/audio_backup_t41_es";
const SCREAM_SLUG = "cd0e9f33"; // GRABACIÓN REAL del jugador (Task 38) — intocable

function ricoSlug(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const VOICE = "xiaochen";
const SPEED = 1.0;
const VOLUME = 2.0;
const GAP_MS = 1400;
const RETRIES = 5;
const CALL_TIMEOUT_MS = 30000;
// "hombre curtido, voz fuerte y grave": pitch −1,9 semitonos + graves + compresor
const POST_AF = "asetrate=24000*0.90,aresample=24000,atempo=1.1111,bass=g=4:f=150,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,loudnorm=I=-15:TP=-1.0";

process.on("unhandledRejection", (e) => {
  console.error(`(rechazo SDK ignorado: ${String(e).slice(0, 120)})`);
});

function postProcess(wavPath, mp3Path) {
  const r = spawnSync("ffmpeg", ["-y", "-i", wavPath, "-af", POST_AF,
    "-codec:a", "libmp3lame", "-q:a", "3", mp3Path], { timeout: 30000 });
  if (r.status !== 0 || !existsSync(mp3Path) || statSync(mp3Path).size < 1000) {
    throw new Error(`ffmpeg falló para ${mp3Path}`);
  }
}

async function genOne(zai, text, mp3Path) {
  const tmp = mp3Path.replace(/\.mp3$/, ".tmp.wav");
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
      writeFileSync(tmp, buffer);
      postProcess(tmp, mp3Path);
      try { rmSync(tmp); } catch { /* ya no está */ }
      return true;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (attempt === RETRIES) {
        console.error(`FALLO [${mp3Path}]: ${msg}`);
        return false;
      }
      const waitS = msg.includes("429") ? 25 + attempt * 20 : 3 + attempt * 4;
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  return false;
}

async function main() {
  // backup del banco anterior (una vez)
  if (!existsSync(BACKUP)) {
    mkdirSync(BACKUP, { recursive: true });
    for (const f of existsSync(OUT) ? await (await import("node:fs")).promises.readdir(OUT) : []) {
      if (f === `${SCREAM_SLUG}.mp3`) continue; // el grito real NO se copia a backup: se queda en sitio
      (await (await import("node:fs")).promises.copyFile(join(OUT, f), join(BACKUP, f)));
    }
    console.log(`backup del banco anterior → ${BACKUP}`);
  }
  mkdirSync(OUT, { recursive: true });
  const zai = await ZAI.create();
  const bank = JSON.parse(readFileSync(join(BASE, "insults_es.json"), "utf8"));
  const jobs = [];
  let skip = 0;
  const T0 = Date.now();
  for (const lines of Object.values(bank)) {
    for (const text of lines) {
      const slug = ricoSlug(text);
      if (slug === SCREAM_SLUG) { console.error("PROTEGIDO: slug del grito real en el banco — ignorado"); continue; }
      const file = join(OUT, `${slug}.mp3`);
      if (existsSync(file) && statSync(file).size > 1000 && statSync(file).mtimeMs > T0 - 2000) { skip++; continue; }
      jobs.push({ text, file, slug });
    }
  }
  console.log(`[es] ${jobs.length} por generar (${skip} recién generadas se saltan), voz=${VOICE} pitch 0,90`);
  let ok = 0, fail = 0;
  for (const job of jobs) {
    const done = await genOne(zai, job.text, job.file);
    if (done) { ok++; process.stdout.write("."); } else fail++;
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  process.stdout.write("\n");
  console.log(`LISTO es: ok=${ok} skip=${skip} fail=${fail}`);
  // verificación: el grito real sigue intacto
  const scream = join(OUT, `${SCREAM_SLUG}.mp3`);
  if (existsSync(scream)) console.log(`grito real intacto: ${statSync(scream).size} B`);
  else console.error("AVISO: no se encuentra el grito real cd0e9f33.mp3");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
