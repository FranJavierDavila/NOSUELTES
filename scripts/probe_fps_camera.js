/* Confirma el compuesto de la mirada adelantada: a mas FPS, mas alto se va la
   camara (equilibrio desiredY + 0.35/ganancia). Prueba en varias resoluciones. */
const { chromium } = require("playwright");
const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [w, h] of [[640, 480], [1280, 900]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => ({
      cam: window.__NS.camera(),
      pelvisY: +window.__NS.pelvisY().toFixed(2),
      fps: window.__NS.frames ? null : null,
    }));
    console.log(`${w}x${h}: pelvis=${r.pelvisY} targetY=${r.cam.targetY} (exceso=${(r.cam.targetY - Math.max(1.0, r.pelvisY) - 0.55).toFixed(2)} m sobre la zona muerta) dist=${r.cam.dist}`);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
