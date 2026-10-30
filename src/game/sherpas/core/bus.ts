// EventBus tipado — eventos del doc 3.4 + eventos de presentación.
// La comunicación hacia arriba es SIEMPRE por EventBus (doc 3.1).

export type Limb = "hand_l" | "hand_r" | "foot_l" | "foot_r";
export type ReleaseCause = "overload" | "exhaustion" | "bird" | "trash" | "player" | "broken_anchor" | "transfer" | "slip";
export type AnchorTypeId = "rock_firm" | "rock_loose" | "ice" | "ice_thin" | "snow" | "ice_urine" | string;

export interface SherpasEvents {
  // Agarres y anclajes (doc 3.4)
  LimbGripped: { playerId: 0 | 1; limb: Limb; anchorId: string };
  LimbReleased: { playerId: 0 | 1; limb: Limb; cause: ReleaseCause };
  AnchorCracked: { anchorId: string; type: AnchorTypeId };
  AnchorBroken: { anchorId: string; type: AnchorTypeId };
  AnchorWeakened: { anchorId: string; durability: number };
  AnchorWet: { anchorId: string };
  // Cuerda y equilibrio
  RopeOverstretched: { level: number };
  RopeRecovered: { record: unknown };
  LoadImbalance: { playerId: 0 | 1; share: number };
  // Ricachón
  RichManAction: { kind: string };
  RichManState: { state: string };
  TrashThrown: { position: { x: number; y: number; z: number } };
  UrineSplash: { position: { x: number; y: number; z: number }; wetAnchors: string[] };
  RichMassChanged: { massKg: number };
  InsultSaid: { lineId: string; context: string; text: string; /** fichero del banco real (opcional: si falta, elige por contexto) */ file?: string };
  RichBumpWall: { speed: number };
  // Pájaros
  BirdTelegraph: { birdId: number; targetPlayer: 0 | 1 };
  BirdHit: { birdId: number; playerId: 0 | 1; limb: Limb };
  BirdAborted: { birdId: number };
  BirdStolen: { birdId: number };
  // CÓNDOR (petición del jugador: posa en la tabla y PESA)
  CondorLanded: { birdId: number; side: -1 | 1 };
  CondorLeft: { birdId: number };
  // CAJAS DEL RICACHÓN (petición: cajas sobre la tabla que pueden caer y ENOJAN)
  BoxesPlaced: { count: number; side: -1 | 1 };
  BoxesFell: { count: number; side: -1 | 1 };
  // DRON REPARTIDOR (petición: deja una sorpresa PESADA junto al ricachón)
  DroneDelivered: { kg: number; offsetFrac: number };
  DroneLost: { kg: number };
  // SUPER FLATULENCIA (presa verde → pedo-propulsor)
  FartGained: { playerId: 0 | 1 };
  FartLaunched: { playerId: 0 | 1; fromY: number };
  // Progresión
  PlayerFell: { playerId: 0 | 1; cause?: "two_hands" | "no_grips" };
  TeamFell: { record: unknown };
  // SEGURO DE CUERDA (Task 36): la cuerda de porteo atrapa la caída individual
  RopeCaught: { playerId: 0 | 1; dropM: number };
  RopeHaulStart: { playerId: 0 | 1 };
  // T58-E: la cuerda de reserva se agotó deslizando → el colgado cae
  RopeReleased: { playerId: 0 | 1 };
  // T58-D EMOTES: animación puntual disparada en un escalador
  EmotePlayed: { playerId: 0 | 1; name: string };
  CampReached: { campId: string; phase: number };
  SummitReached: { record: unknown };
  PhaseChanged: { phase: number };
  PropinaChanged: { value: number; delta: number };
  // Sistema
  Message: { text: string; kind: "info" | "warn" | "danger" };
  Telegraph: { eventId: string; seconds: number; text?: string };
  SnapshotTick: { tick: number };
}

export type EventName = keyof SherpasEvents;

type Handler<K extends EventName> = (payload: SherpasEvents[K]) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();
  /** T60 RED: oyentes "todos los eventos" (tap de red — el host reenvía al guest). */
  private anyHandlers = new Set<(name: EventName, payload: unknown) => void>();

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(fn as Handler<EventName>);
    return () => { set!.delete(fn as Handler<EventName>); };
  }

  /** T60: suscripción a TODOS los eventos (para el tap de red). Devuelve baja. */
  onAny(fn: (name: EventName, payload: unknown) => void): () => void {
    this.anyHandlers.add(fn);
    return () => { this.anyHandlers.delete(fn); };
  }

  emit<K extends EventName>(name: K, payload: SherpasEvents[K]): void {
    for (const fn of this.anyHandlers) {
      try { fn(name, payload); } catch (err) {
        console.error(`[Sherpas] any-handler error en ${String(name)}:`, err);
      }
    }
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) {
      try { (fn as Handler<K>)(payload); } catch (err) {
        console.error(`[Sherpas] handler error en ${String(name)}:`, err);
      }
    }
  }

  clear(): void { this.handlers.clear(); this.anyHandlers.clear(); }
}
