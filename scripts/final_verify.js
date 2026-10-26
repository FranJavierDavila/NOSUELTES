/* Capturas finales: juego encuadrado con boton de menu (DPR 1.5) + menu abierto. */
const { chromium } = require("playwright");
const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1568, height: 1100 }, deviceScaleFactor: 1.5 });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(2500);
  // Boton de menu visible en la pantalla de juego.
  const btn = await page.evaluate(() => {
    const b = document.getElementById("hud-menu-btn");
    const r = b.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0, x: Math.round(r.x), y: Math.round(r.y), text: b.textContent.trim() };
  });
  console.log("boton menu:", JSON.stringify(btn));
  await page.screenshot({ path: "/home/z/my-project/download/final-1-juego-encuadre.png" });

  // Jugar 2 movimientos reales (agarre por teclado + arrastre del objetivo).
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Lista"); b?.click(); });
  await page.waitForTimeout(500);
  const hand = (await page.evaluate(() => window.__NS.limbScreen())).find((l) => l.limb === "hand_l");
  await page.mouse.move(hand.x, hand.y);
  await page.mouse.down();
  await page.mouse.move(hand.x + 30, hand.y - 120, { steps: 8 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/home/z/my-project/download/final-2-arrastrando.png" });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // Abrir el menu en partida: pausa + Continuar.
  await page.click("#hud-menu-btn");
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => ({
    visible: !document.getElementById("hud-intro").classList.contains("hidden"),
    label: document.getElementById("hud-intro-dismiss").textContent.trim(),
    state: window.__NS.state(),
  }));
  console.log("menu en partida:", JSON.stringify(menu));
  await page.screenshot({ path: "/home/z/my-project/download/final-3-menu-en-partida.png" });
  await page.click("#hud-intro-dismiss");
  await page.waitForTimeout(400);
  console.log("tras continuar:", await page.evaluate(() => window.__NS.state()));
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
