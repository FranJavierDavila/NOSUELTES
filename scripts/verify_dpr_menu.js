/* Verifica en PRODUCCION el fix DPR: agarre exacto, arrastre que sigue al cursor,
   boton de menu y guarda de camara. DPR 1.5 como el equipo del jugador. */
const { chromium } = require("playwright");

const URL = "https://preview-chat-0335df1a-0259-4d41-a59e-133f5043a4c6.space-z.ai/";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1568, height: 1100 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.getElementById("hud-intro-dismiss")?.click());
  await page.waitForTimeout(2500);

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const cam = await page.evaluate(() => window.__NS.camera());
  console.log(`DPR=${dpr} camara: targetY=${cam.targetY} dist=${cam.dist} (guarda activa)`);

  // 1. AGARRE EXACTO: clic EXACTAMENTE sobre la mano izquierda (px CSS).
  const limbs = await page.evaluate(() => window.__NS.limbScreen());
  const hand = limbs.find((l) => l.limb === "hand_l");
  await page.mouse.move(hand.x, hand.y);
  await page.mouse.down();
  await page.mouse.move(hand.x - 15, hand.y - 40, { steps: 3 });
  await page.waitForTimeout(250);
  const grab = await page.evaluate(() => ({ dragging: window.__NS.dragging(), selected: window.__NS.selected() }));
  console.log(`1) agarre en (${hand.x},${hand.y}): dragging=${grab.dragging} selected=${grab.selected} ${grab.dragging && grab.selected === "hand_l" ? "PASS" : "FAIL"}`);

  // 2. ARRASTRE QUE SIGUE AL CURSOR: proyecta el objetivo del preview y compara con el cursor.
  const cx = hand.x - 90, cy = hand.y - 170;
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.waitForTimeout(300);
  const track = await page.evaluate(([cx, cy]) => {
    const p = window.__NS.preview();
    if (!p || !p.target) return { ok: false, why: "sin preview" };
    const s = window.__NS.project(p.target.x, p.target.y, p.target.z);
    return { ok: Math.hypot(s.x - cx, s.y - cy) < 24, dx: Math.round(s.x - cx), dy: Math.round(s.y - cy), target: p.target };
  }, [cx, cy]);
  console.log(`2) objetivo bajo el cursor: dx=${track.dx} dy=${track.dy} ${track.ok ? "PASS" : "FAIL " + JSON.stringify(track)}`);

  // 3. Soltar sobre una presa real (r2 de la escalera) para comprobar el flujo completo.
  const holdScreen = await page.evaluate(() => {
    // presa r2 de champ_01 en (x=-0.18,y=1.98) aprox -> proyecta el plano de presas
    return window.__NS.project(-0.18, 1.98, -0.18);
  });
  await page.mouse.move(holdScreen.x, holdScreen.y, { steps: 6 });
  await page.waitForTimeout(400);
  const snap = await page.evaluate(() => window.__NS.preview());
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ state: window.__NS.state(), anchors: window.__NS.anchors() }));
  const handAnchor = after.anchors.find((a) => a.limb === "hand_l");
  console.log(`3) soltar en presa: snap=${snap?.snap ?? "nada"} ancla al soltar=${handAnchor ? handAnchor.hold : "ninguna"} state=${after.state}`);

  // 4. BOTON DE MENU: existe, abre el menu, "Continuar", reanuda.
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Lista"); b?.click(); });
  await page.waitForTimeout(400);
  await page.click("#hud-menu-btn");
  await page.waitForTimeout(400);
  const menuState = await page.evaluate(() => ({
    introVisible: !document.getElementById("hud-intro").classList.contains("hidden"),
    dismissLabel: document.getElementById("hud-intro-dismiss").textContent,
    gamePaused: window.__NS.state(),
  }));
  await page.click("#hud-intro-dismiss");
  await page.waitForTimeout(400);
  const afterMenu = await page.evaluate(() => ({
    introHidden: document.getElementById("hud-intro").classList.contains("hidden"),
    state: window.__NS.state(),
  }));
  const menuOk = menuState.introVisible && menuState.dismissLabel === "Continuar" && menuState.gamePaused === "PAUSED"
    && afterMenu.introHidden && afterMenu.state === "PLAYING";
  console.log(`4) menu: abre=${menuState.introVisible} etiqueta="${menuState.dismissLabel}" pausa=${menuState.gamePaused} reanuda=${afterMenu.state} ${menuOk ? "PASS" : "FAIL"}`);

  console.log("pageerrors:", errors.length ? errors.slice(0, 3) : "ninguno");
  await browser.close();
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
