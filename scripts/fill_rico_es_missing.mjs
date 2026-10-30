// T42-AUDIO-FILL — COMPLETA el banco ES del ricachón SOLO con los ausentes.
// El banco T41 quedó a 28/65 por cuota de TTS; este relleno es idéntico al
// regen (voz xiaochen 94 Hz + pitch 0,90 → ~85 Hz, graves+compresor+loudnorm)
// pero SALTA todo fichero sano existente (no regenera lo ya servido).
// PROTEGIDO: el grito real cd0e9f33.mp3 NUNCA se toca.
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE = "public/content/sherpas";
const OUT = "public/audio/rico/es";

function ricoSlug(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const VOICE = "xiaochen";
const SPEED = 1.0;
const VOLUME = 2.0;
const GAP_MS = 1400;
const RETRIES = 8;
const CALL_TIMEOUT_MS = 30000;
/** paciencia con la cuota: si N ficheros seguidos agotan TODOS sus reintentos
 *  por 429, la cuota está muerta — abortar limpio (re-ejecutable luego). */
const MAX_CONSECUTIVE_DEAD = 3;
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
  let quotaDead = false;
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
        quotaDead = msg.includes("429");
        return false;
      }
      // 429 → paciencia larga (la ventana de cuota puede ser de minutos)
      const waitS = msg.includes("429") ? 70 + attempt * 15 : 3 + attempt * 4;
      await new Promise((r) => setTimeout(r, waitS * 1000));
    }
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const zai = await ZAI.create();
  const bank = JSON.parse(readFileSync(join(BASE, "insults_es.json"), "utf8"));
  const SCREAM_SLUG = "cd0e9f33"; // GRABACIÓN REAL del jugador — intocable
  const jobs = [];
  let healthy = 0;
  for (const lines of Object.values(bank)) {
    for (const text of lines) {
      const slug = ricoSlug(text);
      if (slug === SCREAM_SLUG) continue;
      const file = join(OUT, `${slug}.mp3`);
      if (existsSync(file) && statSync(file).size > 1000) { healthy++; continue; }
      jobs.push({ text, file, slug });
    }
  }
  console.log(`[fill-es] sanos=${healthy}  por generar=${jobs.length}  voz=${VOICE} pitch 0,90`);
  let ok = 0, fail = 0, consecDead = 0;
  const T0 = Date.now();
  for (const job of jobs) {
    const done = await genOne(zai, job.text, job.file);
    if (done) { ok++; consecDead = 0; process.stdout.write("."); }
    else {
      fail++;
      consecDead++;
      if (consecDead >= MAX_CONSECUTIVE_DEAD) {
        console.error(`CUOTA MUERTA (${consecDead} ficheros seguidos sin poder generarse) — aborto limpio; re-ejecutar más tarde.`);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  process.stdout.write("\n");
  console.log(`LISTO fill-es: ok=${ok} fail=${fail} en ${((Date.now() - T0) / 1000).toFixed(0)}s`);
  const scream = join(OUT, `${SCREAM_SLUG}.mp3`);
  if (existsSync(scream)) console.log(`grito real intacto: ${statSync(scream).size} B`);
  else console.error("AVISO: no se encuentra el grito real cd0e9f33.mp3");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
