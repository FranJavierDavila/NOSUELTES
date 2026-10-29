// T41-AUDIO: ASR de las muestras del A/B de voces graves (rate limit: pausas).
// Puntúa cuántas PALABRAS CLAVE castellanas sobreviven en la transcripción.
import ZAI from "z-ai-web-dev-sdk";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/voice-ab-t41";
const DONE = join(OUT, "results.txt");
const KEYWORDS_DEFAULT = [
  ["hostia", "joder", "resbalo", "pagas", "cabron"],
  ["joder", "muevete", "gilipollas", "tiempo", "dinero"],
];
// muestras: [nombre, keywords] — las post-procesadas usan la frase 0
const SAMPLES = [
  ["xiaochen_0", KEYWORDS_DEFAULT.slice(0, 1)], ["xiaochen_1", KEYWORDS_DEFAULT.slice(1)],
  ["jam_0", KEYWORDS_DEFAULT.slice(0, 1)], ["jam_1", KEYWORDS_DEFAULT.slice(1)],
  ["luodo_0", KEYWORDS_DEFAULT.slice(0, 1)], ["luodo_1", KEYWORDS_DEFAULT.slice(1)],
  ["kazi_0", KEYWORDS_DEFAULT.slice(0, 1)], ["kazi_1", KEYWORDS_DEFAULT.slice(1)],
  ["tongtong_0", KEYWORDS_DEFAULT.slice(0, 1)], ["tongtong_1", KEYWORDS_DEFAULT.slice(1)],
  ["post90_0", KEYWORDS_DEFAULT.slice(0, 1)], ["post84_0", KEYWORDS_DEFAULT.slice(0, 1)],
];

function score(text, kws) {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hit = kws.filter((k) => t.includes(k)).length;
  return `${hit}/${kws.length}`;
}

async function main() {
  const zai = await ZAI.create();
  const doneSet = new Set(existsSync(DONE) ? readFileSync(DONE, "utf8").split("\n").map((l) => l.split("|")[0]) : []);
  for (const [name, kws] of SAMPLES) {
    for (let i = 0; i < kws.length; i++) {
      const key = `${name}`;
      const file = join(OUT, `${name}.wav`);
      if (!existsSync(file)) { console.log(`(no existe ${key})`); continue; }
      if (doneSet.has(key)) { console.log(`(ya hecho ${key})`); continue; }
      let done = false;
      for (let a = 0; a < 4 && !done; a++) {
        try {
          const b64 = readFileSync(file).toString("base64");
          const r = await zai.audio.asr.create({ file_base64: b64 });
          const txt = (r.text || "").trim();
          console.log(`ASR ${name}: "${txt}"  → claves ${score(txt, kws[i])}`);
          appendFileSync(DONE, `${key}|${txt}\n`);
          done = true;
        } catch (e) {
          const m = String(e?.message ?? e).slice(0, 80);
          if (a === 3) console.error(`ASR FALLO ${name}: ${m}`);
          else await new Promise((r) => setTimeout(r, 30000));
        }
      }
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
