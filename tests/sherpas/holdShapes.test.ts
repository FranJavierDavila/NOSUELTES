import { describe, expect, it } from "vitest";
import {
  holdShapeRecipe, holdUsesWallRock, holdVariantForId,
} from "../../src/game/sherpas/world/holdShapes";

// T63 — anclajes naturales pero identificables: cada tipo de presa tiene UNA
// FORMA propia (bulto con magnesio = firme, losa agrietada inclinada = suelta,
// carámbanos = hielo, muñón = nieve, bulbo luminoso = sorpresa) elegida por
// hash determinista del id, sobre la textura de roca del propio muro.

const ALL_TYPES = [
  "rock_firm", "rock_loose", "ice", "ice_thin", "ice_plate",
  "ice_urine", "snow", "surprise_fart",
] as const;

describe("T63 — holdShapes: recetas de presa", () => {
  it("hay receta para TODOS los tipos de anchor_types y para desconocidos", () => {
    for (const t of ALL_TYPES) {
      const r = holdShapeRecipe(t, 0);
      expect(r.parts.length).toBeGreaterThan(0);
      expect(r.parts.every((p) => p.rx > 0 && p.ry > 0 && p.rz > 0)).toBe(true);
      expect(r.parts.every((p) => p.tint.every((c) => Number.isFinite(c) && c >= 0 && c <= 1))).toBe(true);
      expect(r.alpha).toBeGreaterThan(0);
      expect(r.alpha).toBeLessThanOrEqual(1);
    }
    // desconocido → bulto de roca neutro (defensivo, nunca rompe la escena)
    const weird = holdShapeRecipe("tipo_futuro", 0);
    expect(weird.kind).toBe("rock");
    expect(weird.parts.length).toBe(3);
  });

  it("roca firme lleva MAGNESIO y roca suelta GRIETAS + vuelco (identificación)", () => {
    for (let v = 0; v < 3; v++) {
      const firm = holdShapeRecipe("rock_firm", v);
      expect(firm.chalk).not.toBeNull(); // la mancha blanca del buen agarre
      expect(firm.cracks.length).toBe(0);
      expect(firm.tilt[0]).toBe(0);

      const loose = holdShapeRecipe("rock_loose", v);
      expect(loose.chalk).toBeNull(); // nadie encala la roca que va a ceder
      expect(loose.cracks.length).toBeGreaterThanOrEqual(2); // astillada
      expect(Math.abs(loose.tilt[0]) + Math.abs(loose.tilt[1])).toBeGreaterThan(0.02); // inclinada
    }
  });

  it("hielo translúcido, nieve opaca, sorpresa luminosa y más grande", () => {
    expect(holdShapeRecipe("ice", 0).alpha).toBeLessThan(0.9);
    expect(holdShapeRecipe("ice_thin", 0).alpha).toBeLessThan(holdShapeRecipe("ice", 0).alpha);
    expect(holdShapeRecipe("snow", 0).alpha).toBe(1);
    const fart = holdShapeRecipe("surprise_fart", 0);
    expect(fart.emissive).not.toBeNull();
    expect(fart.scale).toBeGreaterThan(1.2);
  });

  it("el tinte del tipo MEZCLA la paleta (UI y mundo cuentan lo mismo)", () => {
    const neutral = holdShapeRecipe("rock_firm", 0, undefined);
    const tinted = holdShapeRecipe("rock_firm", 0, "#ff0000");
    expect(tinted.parts[0]!.tint[0]).toBeGreaterThan(neutral.parts[0]!.tint[0]!); // tira al rojo
    expect(tinted.parts[0]!.tint[1]).toBeLessThan(neutral.parts[0]!.tint[1]!);
    // hex inválido → se ignora (defensivo)
    expect(holdShapeRecipe("rock_firm", 0, "no-es-hex")).toEqual(neutral);
  });

  it("variantes DIFERENTES para el mismo tipo (pared no clónica)", () => {
    const a = holdShapeRecipe("rock_firm", 0);
    const b = holdShapeRecipe("rock_firm", 1);
    const c = holdShapeRecipe("rock_firm", 2);
    const sig = (r: { parts: { x: number; y: number; rx: number }[] }): string =>
      r.parts.map((p) => `${p.x.toFixed(4)}|${p.rx.toFixed(4)}`).join(";");
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(b)).not.toBe(sig(c));
  });

  it("holdVariantForId: determinista, reparte y NO colisiona en lote realista", () => {
    expect(holdVariantForId("h42")).toBe(holdVariantForId("h42"));
    const counts = [0, 0, 0];
    for (let i = 0; i < 240; i++) counts[holdVariantForId(`hold_${i}`) % 3]++;
    // reparto razonable entre las 3 variantes (sin monopoly de ninguna)
    for (const c of counts) expect(c).toBeGreaterThan(240 / 3 - 40);
    for (const c of counts) expect(c).toBeLessThan(240 / 3 + 40);
  });

  it("solo la roca se dibuja con la textura del MURO (integración real)", () => {
    expect(holdUsesWallRock("rock_firm")).toBe(true);
    expect(holdUsesWallRock("rock_loose")).toBe(true);
    expect(holdUsesWallRock("desconocido")).toBe(true);
    expect(holdUsesWallRock("ice")).toBe(false);
    expect(holdUsesWallRock("snow")).toBe(false);
    expect(holdUsesWallRock("surprise_fart")).toBe(false);
  });

  it("es determinista: misma entrada → misma receta byte a byte", () => {
    const snap = (t: string, v: number, hex?: string): string =>
      JSON.stringify(holdShapeRecipe(t, v, hex));
    expect(snap("rock_loose", 2, "#b08968")).toBe(snap("rock_loose", 2, "#b08968"));
    expect(snap("ice", 1, "#9ad1e8")).toBe(snap("ice", 1, "#9ad1e8"));
  });
});
