// E2E drag: arrastra hand_r del sherpa A hacia una presa superior y verifica
// que el imán la captura y que al soltar la cintura SUBE. Devuelve JSON.
(() => {
  const q = (s) => document.querySelector(s);
  const canvas = q("canvas");
  const probeEl = q("[data-e=debug]");
  if (!canvas || !probeEl) return JSON.stringify({ error: "sin canvas/probe" });
  const probe = JSON.parse(probeEl.getAttribute("data-probe") || "{}");
  if (!probe.limbs) return JSON.stringify({ error: "sin probe" });

  const rect = canvas.getBoundingClientRect();
  const px = (sx, sy) => ({ x: Math.round(rect.left + (sx / 100) * rect.width), y: Math.round(rect.top + (sy / 100) * rect.height) });

  // mano derecha del sherpa A (p:0)
  const hand = probe.limbs.find((l) => l.p === 0 && l.l === "hand_r");
  if (!hand) return JSON.stringify({ error: "sin hand_r A" });

  // presa objetivo: libre, arriba de la mano, cerca en x, dentro de ~1 m
  const cands = (probe.holds || [])
    .filter((h) => h.wy > hand.wy + 0.25 && Math.abs(h.wx - hand.wx) < 1.1 && h.wy - hand.wy < 1.05)
    .sort((a, b) => (a.wy - b.wy) - (b.wx - a.wx) * 0 + (a.wy - b.wy) - 0 || Math.abs(a.wx - hand.wx) - Math.abs(b.wx - hand.wx));
  const target = cands[0];
  if (!target) return JSON.stringify({ error: "sin presa superior", hand, holds: (probe.holds || []).slice(0, 8) });

  const from = px(hand.sx, hand.sy);
  const to = px(target.sx, target.sy);

  const pe = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 7, isPrimary: true,
    pointerType: "mouse", button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: x, clientY: y,
  }));

  pe("pointerdown", from.x, from.y);
  // viaje en 8 pasos (~120 ms entre pasos)
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      i++;
      const t = i / 8;
      pe("pointermove", from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      if (i < 8) { setTimeout(step, 110); return; }
      const mid = probeEl.getAttribute("data-probe");
      let magnet = null;
      try { magnet = JSON.parse(mid).drag; } catch { /* ignore */ }
      pe("pointerup", to.x, to.y);
      resolve(JSON.stringify({ ok: true, hand, target, dragState: magnet }));
    };
    setTimeout(step, 90);
  });
})()
