/**
 * Bus de eventos semanticos (seccion 12): la logica emite, la presentacion decide
 * recursos y volumen. HoldAcquired, HoldRejected, StrainStarted, OverloadStarted,
 * GripReleased, FallStarted, ChallengeSuccess, ChallengeFailed y ResetStarted.
 */
import { EventListener, GameEvent } from "../types";

export class EventBus {
  private listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: GameEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (err) {
        // La presentacion no debe tumbar la simulacion.
        console.error("Error en listener de eventos", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
