import { test } from "node:test";
import assert from "node:assert/strict";
import { MODE_FRAMES, resolvePreset } from "thinking-orbs/engine";
import {
  MAX_DPR,
  REDUCED_MOTION_T,
  drawOrb,
  orbGeometry,
  orbScale,
  orbTime,
  type OrbContext,
} from "../src/components/orb/orb-paint.ts";
import type { OrbAnimation } from "../src/orb-state.ts";

const STATES: OrbAnimation[] = ["breathing", "connecting", "listening", "composing", "working"];

type Call = { op: string; args: number[]; style?: string };

function recorder(): { ctx: OrbContext; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: "" as CanvasRenderingContext2D["fillStyle"],
    strokeStyle: "" as CanvasRenderingContext2D["strokeStyle"],
    lineWidth: 1,
    setTransform: (...args: number[]) => calls.push({ op: "setTransform", args }),
    clearRect: (...args: number[]) => calls.push({ op: "clearRect", args }),
    beginPath: () => undefined,
    arc: (...args: number[]) => calls.push({ op: "arc", args: args.slice(0, 3), style: String(ctx.fillStyle) }),
    fill: () => undefined,
    moveTo: (...args: number[]) => calls.push({ op: "moveTo", args }),
    lineTo: () => undefined,
    stroke: () => calls.push({ op: "stroke", args: [ctx.lineWidth], style: String(ctx.strokeStyle) }),
  };
  return { ctx: ctx as unknown as OrbContext, calls };
}

const grey = (style: string | undefined) => Number(/rgba\((\d+),/.exec(style ?? "")?.[1]);

test("time follows the shared clock times the preset speed and the speed multiplier", () => {
  assert.equal(orbTime(0, 3.24, 1), 0);
  assert.equal(orbTime(2000, 3.24, 0.5), 3.24);
  assert.equal(orbTime(1000, 1.885, 1), 1.885);
  assert.equal(REDUCED_MOTION_T, 0.6);
});

test("the backing store is the displayed size times the device pixel ratio, capped at 2", () => {
  assert.deepEqual(orbScale(64, 64, 1), { pixels: 64, scale: 1 });
  assert.deepEqual(orbScale(48, 64, 1), { pixels: 48, scale: 0.75 });
  assert.deepEqual(orbScale(56, 64, 2), { pixels: 112, scale: 1.75 });
  assert.deepEqual(orbScale(128, 64, 2), { pixels: 256, scale: 4 });
  assert.deepEqual(orbScale(128, 64, 3), { pixels: 256, scale: 4 });
  assert.deepEqual(orbScale(20, 20, 1.5), { pixels: 30, scale: 1.5 });
  assert.deepEqual(orbScale(48, 64, 0), { pixels: 48, scale: 0.75 });
  assert.equal(MAX_DPR, 2);
});

test("the geometry is the library's preset; dotSize scales only the radii", () => {
  for (const state of STATES) {
    const plain = orbGeometry(state, 64);
    const preset = resolvePreset(state, 64);
    assert.equal(plain.speed, preset.speed);
    assert.deepEqual(plain.opts, preset.opts);
    assert.equal(plain.frame, MODE_FRAMES[preset.mode]);
    const bold = orbGeometry(state, 64, 4 / 3);
    assert.equal(bold.speed, preset.speed);
    assert.equal(bold.opts.rSizeMul, (preset.opts.rSizeMul ?? 1) * (4 / 3));
  }
});

test("a frame is drawn in preset units under the size scale, dots in the library's order", () => {
  for (const state of STATES) {
    const geometry = orbGeometry(state, 64);
    const t = orbTime(12_345, geometry.speed, 1);
    const { ctx, calls } = recorder();
    drawOrb(ctx, geometry, t, false, 4);
    assert.deepEqual(calls[0], { op: "setTransform", args: [4, 0, 0, 4, 0, 0] });
    assert.deepEqual(calls[1], { op: "clearRect", args: [0, 0, 64, 64] });
    const expected = geometry.frame(64, t, geometry.opts).dots.map((d) => [d.x, d.y, d.r]);
    const arcs = calls.filter((c) => c.op === "arc").map((c) => c.args);
    assert.ok(arcs.length > 0, state);
    assert.deepEqual(arcs, expected, state);
  }
});

test("dark ink mirrors light ink, so the nearest dots are black on light and white on dark", () => {
  for (const state of STATES) {
    const geometry = orbGeometry(state, 64);
    const light = recorder();
    const dark = recorder();
    drawOrb(light.ctx, geometry, 7, false, 1);
    drawOrb(dark.ctx, geometry, 7, true, 1);
    const lightArcs = light.calls.filter((c) => c.op === "arc");
    const darkArcs = dark.calls.filter((c) => c.op === "arc");
    assert.equal(lightArcs.length, darkArcs.length);
    lightArcs.forEach((c, i) => assert.ok(Math.abs(grey(c.style) + grey(darkArcs[i]?.style) - 255) <= 1, state));
  }
});
