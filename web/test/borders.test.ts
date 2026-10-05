import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BORDERS_KEY, bootValue, bordersAttribute, parseBorders, storedBorders } from "../src/components/theme/borders.ts";

const WEB = new URL("../", import.meta.url);
const css = readFileSync(new URL("src/index.css", WEB), "utf8");
const html = readFileSync(new URL("index.html", WEB), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `no rule for ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  const decls = new Map<string, string>();
  for (const part of source.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  return decls;
}

test("the stored value parses to on unless it is exactly off", () => {
  assert.equal(parseBorders("off"), "off");
  assert.equal(parseBorders("on"), "on");
  assert.equal(parseBorders(null), "on");
  assert.equal(parseBorders(undefined), "on");
  assert.equal(parseBorders(""), "on");
  assert.equal(parseBorders("OFF"), "on");
  assert.equal(parseBorders("false"), "on");
});

test("only off is stored; on removes the key", () => {
  assert.equal(BORDERS_KEY, "apparatus.borders");
  assert.equal(storedBorders("off"), "off");
  assert.equal(storedBorders("on"), null);
  for (const b of ["on", "off"] as const) assert.equal(parseBorders(storedBorders(b)), b);
});

test("off writes data-borders=off on <html>; on writes no attribute", () => {
  assert.equal(bordersAttribute("off"), "off");
  assert.equal(bordersAttribute("on"), null);
});

test("index.html applies the stored choice before first paint", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /localStorage\.getItem\("apparatus\.borders"\)/);
  assert.match(head, /setAttribute\("data-borders", "off"\)/);
  assert.match(head, /removeAttribute\("data-borders"\)/);
  // The read sits in a try: private mode throws on localStorage.
  assert.match(head, /try \{ b = localStorage\.getItem\("apparatus\.borders"\); \} catch/);
});

test("the off block hides every line and puts every surface on the background", () => {
  const off = block(css, ':root[data-borders="off"]');
  assert.equal(off.get("--border"), "transparent");
  assert.equal(off.get("--sidebar-border"), "transparent");
  assert.equal(off.get("--card"), "var(--background)");
  assert.equal(off.get("--popover"), "var(--background)");
  assert.equal(off.get("--sidebar"), "var(--background)");
  // The Switch track draws with --input: it stays.
  assert.equal(off.has("--input"), false);
  // The composer's shadow goes; it must stay a valid box-shadow list item.
  assert.equal(off.get("--composer-shadow"), "0 0 #0000");
});

test("the off block out-ranks .dark and the flat variant is scoped to it", () => {
  // `:root[data-borders="off"]` is (0,2,0); `.dark` is (0,1,0). Both sit on <html>.
  assert.ok(css.indexOf(':root[data-borders="off"] {') > css.indexOf(".dark {"));
  assert.match(css, /@custom-variant flat \(&:is\(:root\[data-borders="off"\] \*\)\);/);
  // On is untouched: the light and dark blocks keep their lines.
  assert.notEqual(block(css, ":root").get("--border"), "transparent");
  assert.notEqual(block(css, ".dark").get("--border"), "transparent");
});

test("boot reads the secure store, and the localStorage copy only when the secure store holds none", () => {
  // The secure store wins: an evicted localStorage copy does not override it.
  assert.equal(bootValue("off", null), "off");
  assert.equal(bootValue("off", "off"), "off");
  // A failed secure write leaves null there; the copy the user saved holds.
  assert.equal(bootValue(null, "off"), "off");
  assert.equal(bootValue(null, null), null);
  assert.equal(parseBorders(bootValue(null, storedBorders("off"))), "off");
  assert.equal(parseBorders(bootValue(null, storedBorders("on"))), "on");
  // The theme boots by the same rule.
  assert.equal(bootValue("dark", "light"), "dark");
  assert.equal(bootValue(null, "light"), "light");
});

test("floating layers carry the float shadow in both themes; on mode never uses it", () => {
  assert.ok(block(css, ":root").get("--float-shadow"));
  assert.ok(block(css, ".dark").get("--float-shadow"));
  assert.match(css, /--shadow-float: var\(--float-shadow\);/);
  // The token only reaches a surface through the flat variant.
  for (const ui of ["popover", "dialog", "sheet"]) {
    const src = readFileSync(new URL(`src/components/ui/${ui}.tsx`, WEB), "utf8");
    assert.match(src, /shadow-(md|lg) flat:shadow-float/, ui);
    assert.doesNotMatch(src.replace(/flat:shadow-float/g, ""), /shadow-float/, ui);
  }
});
