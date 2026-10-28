// Task 35 — EL GRITO DE LA CAÍDA (petición del jugador: "cayendo debe soltar
// un improperio: ¡¡CABRONEEEEESSSS!!!!"). Genera SOLO los MP3 del grito fijo
// del ricachón al caer de la tabla (el resto del banco lo cubre gen_rico_tts).
// Truco de pronunciación: el FICHERO lleva el slug djb2 del texto EXACTO que
// pasa el juego (match.ts → audio.shout → ricoSlug), pero la ENTRADA de la TTS
// es una variante limpia ("¡Cabroneeesss!") para que la voz lo grite natural.
// Re-ejecutable: salta los que existen.
import ZAI from "z-ai-web-dev-sdk";
import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "public/audio/rico";

function ricoSlug(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// texto EXACTO del juego (match.ts) → variante que pronuncia bien la TTS
const JOBS = [
  { file: join(OUT, "es", `${ricoSlug("¡¡CABRONEEEEESSSS!!!!")}.mp3`), say: "¡Cabroneeeesss!" },
  { file: join(OUT, "en", `${ricoSlug("YOU BASTAAAARDS!!!")}.mp3`), say: "You bastaaards!" },
];

const VOICE = "luodo";   // la expresiva del banco
const SPEED = 1.0;       // grito furioso, no burlón
const VOLUME = 5.0;      // GRITANDO DE VERDAD (rango >0..10)
const RETRIES = 3;

async function main() {
  const zai = await ZAI.create();
  let ok = 0;
  for (const { file, say } of JOBS) {
    if (existsSync(file) && statSync(file).size > 800) { console.log(`ya existe: ${file}`); continue; }
    mkdirSync(join(file, ".."), { recursive: true });
    let done = false;
    for (let attempt = 0; attempt <= RETRIES && !done; attempt++) {
      try {
        // WAV: la API ya no acepta response_format "mp3" (error 1214); da igual:
        // audio.ts usa decodeAudioData, que huele el contenedor REAL (cabecera
        // RIFF) y ignora la extensión del fichero.
        const response = await zai.audio.tts.create({
          input: say, voice: VOICE, speed: SPEED, volume: VOLUME,
          response_format: "wav", stream: false,
        });
        const buffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
        if (buffer.length < 800) throw new Error(`buffer corto (${buffer.length}B)`);
        writeFileSync(file, buffer);
        console.log(`OK: ${file} (${buffer.length}B)`);
        done = true; ok++;
      } catch (e) {
        if (attempt === RETRIES) console.error(`FALLO [${file}]: ${e?.message ?? e}`);
        else await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }
  console.log(`LISTO: ok=${ok}/${JOBS.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
