// The live orb without a framework: @apparatus/orb's painter and clock on a
// canvas the size of its host. The host holds the static frame as SVG
// (OrbStill.astro) until the canvas has drawn, so the orb is there before any
// script runs. The ink follows the page theme. The orb holds its frame while
// motion is paused, draws the library's static frame under reduced motion,
// and stops drawing off screen and in a hidden tab. The orbs start once the
// page is idle: the static frame is already on screen, so drawing during load
// buys nothing a visitor sees. On a touch screen they draw at 30 fps.

import { orbClock } from "@apparatus/orb/clock";
import { REDUCED_MOTION_T, drawOrb, orbGeometry, orbScale, orbTime, type OrbGeometry } from "@apparatus/orb/paint";
import { onMotionChange, reduce, userPaused } from "./motion.ts";
import { orbStep, type OrbStateName } from "./orb-steps.ts";

const root = document.documentElement;
const isDark = () => root.classList.contains("dark");
/** On a coarse pointer (a phone or a tablet), every other 60 Hz frame. */
const minFrameMs = window.matchMedia("(pointer: coarse)").matches ? 1000 / 30 - 2 : 0;

export class LiveOrb {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D | null;
  private geometry: OrbGeometry;
  private speed: number;
  private size = 0;
  private scale = 1;
  private lastT: number | null = null;
  private lastDrawMs = 0;
  private visible = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    state: OrbStateName,
  ) {
    const s = orbStep(state);
    this.geometry = orbGeometry(s.animation, 64);
    this.speed = s.speed;
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.className = "absolute inset-0 size-full";
    this.ctx = this.canvas.getContext("2d");
    host.append(this.canvas);

    new ResizeObserver(() => this.resize()).observe(host);
    new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1]?.isIntersecting ?? this.visible;
      this.update();
    }).observe(host);
    new MutationObserver(() => this.paint()).observe(root, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", () => this.update());
    onMotionChange(() => this.update());
    this.resize();
  }

  set(state: OrbStateName): void {
    const s = orbStep(state);
    this.geometry = orbGeometry(s.animation, 64);
    this.speed = s.speed;
    this.paint();
  }

  private resize(): void {
    const size = Math.round(this.host.getBoundingClientRect().width);
    if (size === 0 || size === this.size) return;
    this.size = size;
    const { pixels, scale } = orbScale(size, 64, window.devicePixelRatio || 1);
    this.canvas.width = pixels;
    this.canvas.height = pixels;
    this.scale = scale;
    this.paint();
    this.update();
  }

  /** One frame now: the static frame, the held frame, or the clock's. */
  private paint(): void {
    if (!this.ctx || this.size === 0) return;
    const t = reduce.matches ? REDUCED_MOTION_T : userPaused() && this.lastT !== null ? this.lastT : this.at(performance.now());
    this.draw(t);
  }

  private at(nowMs: number): number {
    return orbTime(nowMs, this.geometry.speed, this.speed);
  }

  private draw(t: number): void {
    if (!this.ctx) return;
    this.lastT = t;
    drawOrb(this.ctx, this.geometry, t, isDark(), this.scale);
    // The canvas has a frame: the static SVG under it can go.
    this.host.dataset.live = "";
  }

  /** Runs the clock while the orb is on screen, the tab is shown and motion is on. */
  private update(): void {
    const run = this.visible && document.visibilityState !== "hidden" && !reduce.matches && !userPaused() && this.size > 0;
    if (run && !this.unsubscribe) {
      this.unsubscribe = orbClock.subscribe((now) => {
        if (now - this.lastDrawMs < minFrameMs) return;
        this.lastDrawMs = now;
        this.draw(this.at(now));
      });
    } else if (!run && this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      this.paint();
    } else if (!run) {
      this.paint();
    }
  }
}

/** The hero: the orb cycles through the states; a chip pins one for 12 s. The chips work before the orb starts. */
function hero(el: HTMLElement): void {
  const host = el.querySelector<HTMLElement>("[data-orb]");
  const chips = [...el.querySelectorAll<HTMLButtonElement>("[data-orb-chip]")];
  if (!host || chips.length === 0) return;
  const steps = chips.map((c) => c.dataset.orbChip as OrbStateName);
  let orb: LiveOrb | null = null;
  let step = 0;
  let pinnedUntil = 0;
  const show = (i: number) => {
    step = i;
    orb?.set(steps[i]!);
    chips.forEach((c, k) => c.setAttribute("aria-pressed", String(k === i)));
  };
  chips.forEach((chip, i) =>
    chip.addEventListener("click", () => {
      pinnedUntil = performance.now() + 12_000;
      show(i);
    }),
  );
  whenIdle(() => {
    orb = new LiveOrb(host, steps[step]!);
    window.setInterval(() => {
      if (reduce.matches || userPaused() || document.visibilityState === "hidden") return;
      if (performance.now() < pinnedUntil) return;
      show((step + 1) % steps.length);
    }, 4200);
  });
}

/** Runs `fn` when the main thread is free after load, or after 1 s without requestIdleCallback. */
function whenIdle(fn: () => void): void {
  const run = () => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 1000);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

for (const el of document.querySelectorAll<HTMLElement>("[data-orb-hero]")) hero(el);
whenIdle(() => {
  for (const host of document.querySelectorAll<HTMLElement>("[data-orb-static]")) new LiveOrb(host, host.dataset.orbStatic as OrbStateName);
});
