import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, escapeHtml } from "../src/markdown.ts";

test("escapes script tags and attributes", () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<img"));
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("headings", () => {
  assert.equal(renderMarkdown("# Title"), "<h1>Title</h1>");
  assert.equal(renderMarkdown("### Third"), "<h3>Third</h3>");
  assert.equal(renderMarkdown("####### not a heading"), "<p>####### not a heading</p>");
});

test("lists", () => {
  assert.equal(renderMarkdown("- a\n- b\n- c"), "<ul><li>a</li><li>b</li><li>c</li></ul>");
  assert.equal(renderMarkdown("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(renderMarkdown("- a\n\n1. b"), "<ul><li>a</li></ul>\n<ol><li>b</li></ol>");
});

test("code fences and inline code keep their text literal", () => {
  const html = renderMarkdown("```js\nconst x = <b>1</b>;\n```");
  assert.equal(html, '<pre><code class="language-js">const x = &lt;b&gt;1&lt;/b&gt;;</code></pre>');
  assert.equal(renderMarkdown("use `**not bold**` here"), "<p>use <code>**not bold**</code> here</p>");
});

test("bold, italic, links", () => {
  assert.equal(renderMarkdown("**bold** and *it* and _em_"), "<p><strong>bold</strong> and <em>it</em> and <em>em</em></p>");
  assert.equal(
    renderMarkdown("[site](https://example.com/a?b=1&c=2)"),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site</a></p>',
  );
});

test("unsafe link schemes are not linked", () => {
  const html = renderMarkdown("[x](javascript:alert(1)) [y](data:text/html,hi)");
  assert.ok(!html.includes("<a "));
  assert.ok(!html.includes("javascript:alert(1)\""));
});

test("paragraphs, blockquotes and rules", () => {
  assert.equal(renderMarkdown("line one\nline two\n\npara two"), "<p>line one line two</p>\n<p>para two</p>");
  assert.equal(renderMarkdown("> quoted"), "<blockquote><p>quoted</p></blockquote>");
  assert.equal(renderMarkdown("---"), "<hr>");
});

test("pipe tables", () => {
  const html = renderMarkdown("| Region | Orders |\n|---|---:|\n| North | 12 |\n| <b>South</b> | **9** |");
  assert.equal(
    html,
    '<div class="table-wrap"><table><thead><tr><th>Region</th><th style="text-align:right">Orders</th></tr></thead>' +
      '<tbody><tr><td>North</td><td style="text-align:right">12</td></tr>' +
      '<tr><td>&lt;b&gt;South&lt;/b&gt;</td><td style="text-align:right"><strong>9</strong></td></tr></tbody></table></div>',
  );
  assert.equal(
    renderMarkdown("# Weekly orders\n\nA | B\n--|--\n1 | 2\n\nafter"),
    '<h1>Weekly orders</h1>\n<div class="table-wrap"><table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>\n<p>after</p>",
  );
  assert.equal(renderMarkdown("a | b\nnot a delimiter"), "<p>a | b not a delimiter</p>");
});
