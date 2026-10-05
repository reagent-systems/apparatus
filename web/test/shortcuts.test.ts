import { test } from "node:test";
import assert from "node:assert/strict";
import { keyLabel, shortcutFor, talkTarget, type KeyLike } from "../src/hooks/shortcuts.ts";

function key(partial: Partial<KeyLike> & { key: string }): KeyLike {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...partial };
}

test("the modifier is Cmd on a Mac and Ctrl elsewhere", () => {
  assert.equal(shortcutFor(key({ key: "k", code: "KeyK", metaKey: true }), true), "palette");
  assert.equal(shortcutFor(key({ key: "k", code: "KeyK", ctrlKey: true }), true), null);
  assert.equal(shortcutFor(key({ key: "k", code: "KeyK", ctrlKey: true }), false), "palette");
  assert.equal(shortcutFor(key({ key: "k", code: "KeyK", metaKey: true }), false), null);
});

test("Cmd/Ctrl+1..5 name the views in rail order", () => {
  const views = ["thread", "jobs", "screen", "audit", "credits"];
  views.forEach((view, i) => {
    assert.equal(shortcutFor(key({ key: String(i + 1), code: `Digit${i + 1}`, ctrlKey: true }), false), `view:${view}`);
  });
  assert.equal(shortcutFor(key({ key: "6", code: "Digit6", ctrlKey: true }), false), null);
});

test("rail, pane, control, interrupt and the needs-you jump", () => {
  assert.equal(shortcutFor(key({ key: "b", code: "KeyB", metaKey: true }), true), "rail");
  assert.equal(shortcutFor(key({ key: "j", code: "KeyJ", metaKey: true }), true), "pane");
  assert.equal(shortcutFor(key({ key: "C", code: "KeyC", metaKey: true, shiftKey: true }), true), "control");
  assert.equal(shortcutFor(key({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }), true), null);
  assert.equal(shortcutFor(key({ key: "Escape" }), true), "interrupt");
  assert.equal(shortcutFor(key({ key: "∆", code: "KeyJ", altKey: true }), true), "needsYou");
  assert.equal(shortcutFor(key({ key: "j", code: "KeyJ", altKey: true, metaKey: true }), true), null);
});

test("a plain letter is nothing; `key` stands in when `code` is absent", () => {
  assert.equal(shortcutFor(key({ key: "k" }), true), null);
  assert.equal(shortcutFor(key({ key: "k", metaKey: true }), true), "palette");
  assert.equal(shortcutFor(key({ key: "3", ctrlKey: true }), false), "view:screen");
});

test("the Space hold talks anywhere but the VM video", () => {
  assert.equal(talkTarget(null), "free");
  assert.equal(talkTarget("DIV"), "free");
  assert.equal(talkTarget("BUTTON"), "free");
  assert.equal(talkTarget("VIDEO"), "video");
  assert.equal(talkTarget("video"), "video");
});

test("key labels follow the platform", () => {
  assert.equal(keyLabel({ mod: true, key: "K" }, true), "⌘K");
  assert.equal(keyLabel({ mod: true, key: "K" }, false), "Ctrl+K");
  assert.equal(keyLabel({ mod: true, shift: true, key: "C" }, true), "⌘⇧C");
  assert.equal(keyLabel({ mod: true, shift: true, key: "C" }, false), "Ctrl+Shift+C");
  assert.equal(keyLabel({ alt: true, key: "J" }, true), "⌥J");
  assert.equal(keyLabel({ alt: true, key: "J" }, false), "Alt+J");
});
