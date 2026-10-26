/* Oraculo del espacio de coordenadas de scene.pick/createPickingRay a DPR 1.5. */
const { chromium } = require("playwright");
const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1568, height: 1100 }, deviceScaleFactor: 1.5 });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => {
    const ns = window.__NS;
    const hold = { x: -0.42, y: 2.1, z: -0.18 }; // start_l
    const css = ns.project(hold.x, hold.y, hold.z); // ahora CSS px
    const size = ns.renderSize();
    const probe = (x, y) => ns.pickNearest(x, y);
    return {
      dpr: window.devicePixelRatio,
      render: size, css,
      atCss: probe(css.x, css.y),
      atDevice: probe(css.x * 1.5, css.y * 1.5),
      atCssWithEngineScale: null,
      midScreen: probe(Math.round(size.cssW / 2), Math.round(size.cssH / 2)),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
