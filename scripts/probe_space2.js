/* Barrido de factores de escala para descubrir el espacio real de scene.pick. */
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
    const css = ns.project(hold.x, hold.y, hold.z);
    const size = ns.renderSize();
    const out = { dpr: window.devicePixelRatio, size, css, hits: {} };
    for (const f of [0.4, 0.5, 0.6667, 0.75, 1, 1.5, 2]) {
      // NOTA: pickNearest ya multiplica por (renderW/cssW) internamente; para
      // probar el espacio crudo usamos el rayo via preview del teclado no, usamos
      // pickNearest con la coordenada "pre-conversion" css/f*? -> mejor: probamos
      // con el hook pickAt (mismo camino) multiplicando css por f y dividiendo
      // por el factor interno (1.5) para anularlo cuando queramos.
      const internal = size.w / size.cssW;
      const x = (css.x * f) / internal;
      const y = (css.y * f) / internal;
      const hit = ns.pickNearest(x, y);
      out.hits[String(f)] = hit ? hit.name + "@" + hit.dist : null;
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
