/* Prueba DPR: reproduce el juego con deviceScaleFactor 1.5 y verifica el picking. */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1568, height: 1100 },
    deviceScaleFactor: 1.5,
  });
  await page.goto("https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => ({
    state: window.__NS.state(),
    renderSize: window.__NS.renderSize ? undefined : null,
    dpr: window.devicePixelRatio,
    limbs: window.__NS.limbScreen(),
  }));
  console.log("DPR:", info.dpr, "state:", info.state);
  console.log("limbs (CSS px):", JSON.stringify(info.limbs));

  // Intent de agarre REAL con el raton sobre la mano izquierda (como el usuario).
  const hand = info.limbs.find((l) => l.limb === "hand_l");
  console.log(`mouse down at (${hand.x}, ${hand.y}) ...`);
  await page.mouse.move(hand.x, hand.y);
  await page.mouse.down();
  await page.mouse.move(hand.x - 20, hand.y - 60, { steps: 5 });
  await page.waitForTimeout(300);

  const grabbed = await page.evaluate(() => ({
    dragging: window.__NS.dragging(),
    selected: window.__NS.selected(),
  }));
  console.log("grab result:", JSON.stringify(grabbed));

  // Preview: ¿el objetivo sigue al cursor o va desviado?
  await page.mouse.move(hand.x - 100, hand.y - 200, { steps: 5 });
  await page.waitForTimeout(300);
  const preview = await page.evaluate(() => window.__NS.preview());
  console.log("preview:", JSON.stringify(preview));
  await page.mouse.up();
  await browser.close();
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });
