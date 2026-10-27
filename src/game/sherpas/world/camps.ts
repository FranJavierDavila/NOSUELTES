// CampSystem (doc 8.3) + guardado por campamento (doc 2.1: IndexedDB).
import type { EventBus } from "../core/bus";
import type { WallGenerator, CampZone } from "./wallGenerator";

export interface AscentStats {
  timeS: number;
  teamFalls: number;
  anchorsBroken: number;
  maxAltitudeM: number;
}

export interface SavedAscent {
  version: 1;
  seed: number;
  difficulty: string;
  campIndex: number;
  stats: AscentStats;
  propina: number;
  updatedAt: number;
}

export class CampSystem {
  private reached = new Set<string>();
  currentZone: CampZone | null = null;
  resting = false;

  constructor(private events: EventBus, private gen: WallGenerator) {}

  isReached(campId: string): boolean { return this.reached.has(campId); }
  reachedCount(): number { return this.reached.size; }

  /** Llamado cada tick con la altitud del equipo (mínima de los dos sherpas). */
  tick(teamY: number, allAnchored: boolean, dt: number): void {
    const zone = this.gen.campAtOrBelow(teamY);
    const insideZone = this.gen.layout.campZones.some((z) => teamY >= z.yBase - 0.5 && teamY <= z.yTop + 0.5);
    const active = this.gen.layout.campZones.find((z) => teamY >= z.yBase - 0.5 && teamY <= z.yTop + 0.5) ?? null;
    this.currentZone = active;
    this.resting = insideZone && allAnchored;
    if (zone && !this.reached.has(zone.campId) && teamY >= zone.yBase + 0.2) {
      this.reached.add(zone.campId);
      this.events.emit("CampReached", { campId: zone.campId, phase: zone.phase });
    }
    void dt;
  }
}

// ---------- guardado IndexedDB (sin dependencias) ----------

const DB_NAME = "sherpas-al-limite";
const STORE = "progress";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAscent(save: SavedAscent): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(save, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAscent(): Promise<SavedAscent | null> {
  try {
    const db = await openDb();
    const result = await new Promise<SavedAscent | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result as SavedAscent | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

export async function clearAscent(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch { /* sin guardado no hay problema */ }
}
