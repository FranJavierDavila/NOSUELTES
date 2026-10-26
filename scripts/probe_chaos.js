/* Chaos: reproduce el flujo de un usuario real (cambios de pared, R, drags fallidos)
   y vigila pelvisY + estado para cazar la camara/posicion rota. */
const { chromium } = require("playwright");

const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

async function watch(page, label) {
  const s = await page.evaluate(() => ({
    state: window.__NS.state(),
    pelvisY: window.__NS.pelvisY(),
    settle: window.__NS.settle ? window.__NS.settle() : null,
  }));
  const bad = !Number.isFinite(s.pelvisY) || s.pelvisY > 6.5 || s.pelvisY < -1.5;
  console.log(`${bad ? "!!!" : "   "} [${label}] state=${s.state} pelvisY=${s.pelvisY?.toFixed?.(2)} ${bad ? "<<< ANOMALIA" : ""}`);
  return bad;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1568, height: 1100 }, deviceScaleFactor: 1.5 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(1500);
  await watch(page, "inicio E1");

  // 1. Cambios rapidos de pared como usuario impaciente (E1 <-> C1 <-> E1)
  const switches = ["C1·LA PLACA", "E1·LA ESCALERA", "C1·LA PLACA", "E1·LA ESCALERA"];
  for (const name of switches) {
    await page.evaluate((n) => {
      const btns = Array.from(document.querySelectorAll("#hud-switch-list button"));
      const b = btns.find((x) => x.textContent.includes(n.split("·")[1]) || x.textContent.includes(n.split("·")[0]));
      if (b) b.click();
    }, name);
    await page.waitForTimeout(400);
    await watch(page, `justo tras click ${name}`);
    await page.waitForTimeout(2500);
    await watch(page, `tras settle ${name}`);
  }

  // 2. Drags fallidos por toda la pantalla (usuario que no acierta a coger)
  for (const [x, y] of [[700, 900], [800, 700], [900, 500], [600, 400], [784, 550]]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y - 200, { steps: 4 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  await watch(page, "tras drags fallidos");

  // 3. Tecla R varias veces
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(2500);
  await watch(page, "tras R x3");

  // 4. Lista + agarrar por teclado 1-4 y mover el raton
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    btns.find((b) => b.textContent.trim() === "Lista")?.click();
  });
  await page.waitForTimeout(800);
  for (const k of ["Digit1", "Digit2", "Digit3", "Digit4"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(200);
    await page.mouse.move(784 + Math.random() * 300, 550 - Math.random() * 300);
    await page.waitForTimeout(300);
    await page.keyboard.press(k);
  }
  await page.waitForTimeout(2000);
  await watch(page, "tras teclado 1-4");
  await page.screenshot({ path: "/home/z/my-project/download/diag-6-chaos.png" });

  // 5. Vigilancia larga: 10 s mas de juego normal
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(2000);
    if (await watch(page, `t+${i * 2}s`)) {
      await page.screenshot({ path: `/home/z/my-project/download/diag-7-anomalia.png` });
    }
  }
  await browser.close();
  console.log("chaos done");
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
