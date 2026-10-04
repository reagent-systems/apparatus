// The orb. State shows through class names only: no text.

export type OrbState = "idle" | "listening" | "speaking" | "working";

const STATES: readonly OrbState[] = ["idle", "listening", "speaking", "working"];

export class Orb {
  readonly el: HTMLButtonElement;
  private current: OrbState = "idle";

  constructor(onClick: () => void) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "orb orb--idle";
    this.el.setAttribute("aria-label", "voice");
    this.el.addEventListener("click", onClick);
  }

  get state(): OrbState {
    return this.current;
  }

  setState(state: OrbState): void {
    if (state === this.current) return;
    this.current = state;
    for (const s of STATES) this.el.classList.toggle(`orb--${s}`, s === state);
  }

  /** Dim the orb when another device holds the voice session. */
  setHeld(holds: boolean): void {
    this.el.classList.toggle("orb--away", !holds);
  }

  /** The microphone is open (a Live session is up). */
  setLive(live: boolean): void {
    this.el.classList.toggle("orb--live", live);
  }
}
