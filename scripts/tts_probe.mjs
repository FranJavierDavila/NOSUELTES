import ZAI from "z-ai-web-dev-sdk";
const t0 = Date.now();
try {
  const zai = await ZAI.create();
  console.log("create ms:", Date.now() - t0);
  const r = await Promise.race([
    zai.audio.tts.create({ input: "¡Prueba de voz!", voice: "luodo", speed: 1.06, volume: 3.2, response_format: "wav", stream: false }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT 45s")), 45000)),
  ]);
  const buf = Buffer.from(new Uint8Array(await r.arrayBuffer()));
  console.log("OK ms:", Date.now() - t0, "bytes:", buf.length);
} catch (e) {
  console.log("ERROR ms:", Date.now() - t0, e?.message ?? e);
}
