// Task 29 — VOZ DEL RICACHÓN: genera los MP3 burlescos (petición del jugador:
// "si las frases del ricachón pudiesen escucharse gritando con tono burlesco").
// Lee insults_es/en.json y genera public/audio/rico/{es,en}/<slug>.mp3 con el
// MISMO slug djb2 que audio.ts (ricoSlug). Voz expresiva + volumen alto +
// velocidad algo rápida = grito burlón. Re-ejecutable: salta los que existen.
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

const VOICE = "luodo";      // la más expresiva/"infecciosa" del catálogo
const SPEED = 1.06;         // algo rápido = burlón
const VOLUME = 3.2;         // GRITANDO (rango permitido: >0..10)
const CONCURRENCY = 1;      // la API limita peticiones (429): en fila
const GAP_MS = 1500;        // pausa entre llamadas
const RETRIES = 3;

async function genOne(zai, text, path) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await zai.audio.tts.create({
        input: text, voice: VOICE, speed: SPEED, volume: VOLUME,
        response_format: "mp3", stream: false,
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      if (buffer.length < 800) throw new Error(`buffer corto (${buffer.length}B)`);
      writeFileSync(path, buffer);
      return true;
    } catch (e) {
      if (attempt === RETRIES) {
        console.error(`FALLO [${path}]: ${e?.message ?? e}`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); // 429 → retroceso
    }
  }
  return false;
}

async function pool(items, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const zai = await ZAI.create();
  let ok = 0, skip = 0, fail = 0;
  for (const lang of ["es", "en"]) {
    const bank = JSON.parse(readFileSync(join(BASE, `insults_${lang}.json`), "utf8"));
    const dir = join(OUT, lang);
    mkdirSync(dir, { recursive: true });
    const jobs = [];
    for (const lines of Object.values(bank)) {
      for (const text of lines) {
        const file = join(dir, `${ricoSlug(text)}.mp3`);
        if (existsSync(file) && statSync(file).size > 800) { skip++; continue; }
        jobs.push({ text, file });
      }
    }
    console.log(`[${lang}] ${jobs.length} por generar (${skip} ya existían)`);
    await pool(jobs, async ({ text, file }) => {
      const done = await genOne(zai, text, file);
      if (done) { ok++; process.stdout.write("."); }
      else fail++;
      await new Promise((r) => setTimeout(r, GAP_MS));
    });
    process.stdout.write("\n");
  }
  console.log(`LISTO: ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
