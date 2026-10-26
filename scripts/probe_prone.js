/* Diagnostico forceProne: que pasa tras forzar la postura boca abajo. */
const { chromium } = require("playwright");
const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__NS.load("challenge_reach_top"));
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.__NS.grab("hand_l"));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__NS.grab("hand_l"));
  await page.waitForTimeout(300);
  console.log("estado pre-prone:", await page.evaluate(() => window.__NS.state()));
  await page.evaluate(() => window.__NS.forceProne());
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(350);
    const s = await page.evaluate(() => ({
      state: window.__NS.state(),
      posture: window.__NS.posture(),
      anchors: window.__NS.anchors(),
      pelvisY: +window.__NS.pelvisY().toFixed(2),
      evs: window.__NS.events().slice(-3).map((e) => e.type + (e.reason ? ":" + e.reason : "")),
    }));
    console.log(`t+${((i + 1) * 0.35).toFixed(2)}s`, JSON.stringify(s));
    if (s.state === "READY") break;
  }
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
