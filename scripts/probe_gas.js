/* GAS: espera la detonacion DENTRO de la pagina (sin latencia CLI). */
const { chromium } = require("playwright");
const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__NS.load("challenge_stabilize_pose"));
  await page.waitForTimeout(3500);
  const r = await page.evaluate(async () => {
    window.__NS.grab("hand_r");
    await new Promise((r) => setTimeout(r, 500));
    window.__NS.grab("hand_r");
    await new Promise((r) => setTimeout(r, 600));
    const y0 = window.__NS.pelvisY();
    const phase0 = window.__NS.gasTrigger();
    const t0 = performance.now();
    let phase = phase0;
    const samples = [];
    while (performance.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 250));
      phase = window.__NS.gas();
      samples.push(phase);
      if (phase !== "warning") break;
    }
    const yPeak = Math.max(y0, ...Array.from({ length: 8 }, () => window.__NS.pelvisY()));
    return { phase0, phase, samples: samples.slice(0, 12), state: window.__NS.state(), y0: +y0.toFixed(3), yPeak: +yPeak.toFixed(3), delta: +(yPeak - y0).toFixed(3), evs: window.__NS.events().slice(-4).map((e) => e.type + (e.reason ? ":" + e.reason : "")) };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
