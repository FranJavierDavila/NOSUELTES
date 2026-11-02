/**
 * Maquina de estados del desafio (seccion 10.3). Transiciones validadas; condiciones
 * terminales mutuamente excluyentes; el timer solo corre en PLAYING.
 */
import { GameEvent, GameState } from "../types";

const TRANSITIONS: Record<GameState, readonly GameState[]> = {
  LOADING: ["READY", "RESETTING", "ERROR"],
  READY: ["PLAYING", "RESETTING", "ERROR"],
  PLAYING: ["PAUSED", "SUCCESS", "FALLEN", "TIMEOUT", "RESETTING", "ERROR"],
  PAUSED: ["PLAYING", "RESETTING", "ERROR"],
  SUCCESS: ["RESETTING"],
  FALLEN: ["RESETTING"],
  TIMEOUT: ["RESETTING"],
  RESETTING: ["READY", "PLAYING", "ERROR"],
  ERROR: ["RESETTING", "LOADING"]
};

export class GameStateMachine {
  private _state: GameState = "LOADING";

  constructor(private readonly emit: (event: GameEvent) => void) {}

  get state(): GameState {
    return this._state;
  }

  can(to: GameState): boolean {
    return TRANSITIONS[this._state].includes(to);
  }

  /** Cambia de estado si la transicion es valida; emite StateChanged una vez. */
  transition(to: GameState): boolean {
    if (this._state === to) return true;
    if (!this.can(to)) {
      console.warn(`Transicion invalida de estado: ${this._state} -> ${to}`);
      return false;
    }
    const from = this._state;
    this._state = to;
    this.emit({ type: "StateChanged", from, to });
    return true;
  }

  get active(): boolean {
    return this._state === "PLAYING";
  }
}
