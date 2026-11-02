// E2E ciclo completo de ascenso por arrastre: pies primero, luego manos,
// alternando; mide la cintura del sherpa A tras cada movimiento.
(() => {
  const q = (s) => document.querySelector(s);
  const canvas = q("canvas");
  const probeEl = q("[data-e=debug]");
  if (!canvas || !probeEl) return JSON.stringify({ error: "sin canvas/probe" });
  const rect = canvas.getBoundingClientRect();
  const px = (sx, sy) => ({ x: Math.round(rect.left + (sx / 100) * rect.width), y: Math.round(rect.top + (sy / 100) * rect.height) });
  const readProbe = () => JSON.parse(probeEl.getAttribute("data-probe") || "{}");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // elige presa libre más baja POR ENCIMA de la extremidad (ventana 0,25–1,05 m)
  const pickTarget = (probe, limb) => {
    const L = probe.limbs.find((l) => l.p === 0 && l.l === limb);
    if (!L) return null;
    const cands = (probe.holds || [])
      .filter((h) => h.wy > L.wy + 0.22 && h.wy - L.wy < 1.05 && Math.abs(h.wx - L.wx) < 1.15);
    if (!cands.length) return { L, target: null };
    cands.sort((a, b) => (a.wy - b.wy) - (b.wy - a.wy) + Math.abs(a.wx - L.wx) - Math.abs(b.wx - L.wx));
    return { L, target: cands[0] };
  };

  const dragOne = async (probe, limb) => {
    const sel = pickTarget(probe, limb);
    if (!sel || !sel.target) return { limb, skipped: "sin presa" };
    const { L, target } = sel;
    const from = px(L.sx, L.sy);
    const to = px(target.sx, target.sy);
    const pe = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7, isPrimary: true,
      pointerType: "mouse", button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
      clientX: x, clientY: y,
    }));
    pe("pointerdown", from.x, from.y);
    for (let i = 1; i <= 6; i++) {
      pe("pointermove", from.x + (to.x - from.x) * (i / 6), from.y + (to.y - from.y) * (i / 6));
      await wait(70);
    }
    pe("pointerup", to.x, to.y);
    await wait(900); // viaje + asentamiento del atractor
    const after = readProbe();
    const waist = after.a ? after.a.y : null;
    const limbNow = after.limbs ? after.limbs.find((l) => l.p === 0 && l.l === limb) : null;
    return { limb, from: { x: L.wx, y: L.wy }, to: { id: target.id, y: target.wy }, waist, limbNowY: limbNow ? limbNow.wy : null };
  };

  return (async () => {
    const log = [];
    const seq = ["foot_l", "foot_r", "hand_l", "hand_r", "foot_l", "foot_r", "hand_l", "hand_r"];
    for (const limb of seq) {
      const probe = readProbe();
      if (!probe.limbs) { log.push({ limb, skipped: "sin probe" }); continue; }
      log.push(await dragOne(probe, limb));
    }
    const final = readProbe();
    return JSON.stringify({ log, finalA: final.a, finalB: final.b }, null, 1);
  })().then((r) => r);
})()
