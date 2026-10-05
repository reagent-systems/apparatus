import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANE_WIDTH_DEFAULT,
  PANE_WIDTH_MAX,
  PANE_WIDTH_MIN,
  panePercent,
  panePixels,
  formatFlag,
  formatPaneWidth,
  formatView,
  parseFlag,
  parsePaneWidth,
  parseView,
} from "../src/state/selection-codec.ts";

test("the view round-trips; screen and junk read as the thread", () => {
  assert.equal(parseView("jobs"), "jobs");
  assert.equal(parseView("credits"), "credits");
  assert.equal(parseView("screen"), "thread");
  assert.equal(parseView("nope"), "thread");
  assert.equal(parseView(null), "thread");
  assert.equal(formatView("thread"), null);
  assert.equal(formatView("screen"), null);
  assert.equal(formatView("audit"), "audit");
});

test("flags are 1 and 0 with a fallback", () => {
  assert.equal(parseFlag("1", false), true);
  assert.equal(parseFlag("0", true), false);
  assert.equal(parseFlag(null, true), true);
  assert.equal(parseFlag("yes", false), false);
  assert.equal(formatFlag(true), "1");
  assert.equal(formatFlag(false), "0");
});

test("the pane width is a clamped percent", () => {
  assert.equal(parsePaneWidth(null), PANE_WIDTH_DEFAULT);
  assert.equal(parsePaneWidth(""), PANE_WIDTH_DEFAULT);
  assert.equal(parsePaneWidth("abc"), PANE_WIDTH_DEFAULT);
  assert.equal(parsePaneWidth("50.4"), 50);
  assert.equal(parsePaneWidth("1"), PANE_WIDTH_MIN);
  assert.equal(parsePaneWidth("99"), PANE_WIDTH_MAX);
  assert.equal(formatPaneWidth(42.6), "43");
});

test("the pane width is a percent of the window, in 360..640 px", () => {
  assert.equal(panePixels(PANE_WIDTH_DEFAULT, 1440), 605);
  assert.equal(panePixels(PANE_WIDTH_DEFAULT, 1024), 430);
  assert.equal(panePixels(PANE_WIDTH_DEFAULT, 800), 360);
  assert.equal(panePixels(PANE_WIDTH_DEFAULT, 2560), 640);
  assert.equal(panePercent(605, 1440), 42);
  assert.equal(panePercent(panePixels(30, 1440), 1440), 30);
  assert.equal(panePercent(500, 0), PANE_WIDTH_DEFAULT);
});
