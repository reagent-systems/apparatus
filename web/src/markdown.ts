// Minimal markdown to HTML for the `show` pane. DOM-free: returns a string.
//
// Supported: headings, fenced code, inline code, unordered and ordered
// lists, blockquotes, horizontal rules, bold, italic, links. Every character
// of the source is HTML-escaped before any tag is added, and link targets
// are limited to http(s), mailto and relative paths.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_SCHEME = /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i;

function safeHref(escapedUrl: string): string | null {
  const url = escapedUrl.trim();
  if (SAFE_SCHEME.test(url)) return url;
  // a bare relative path: no scheme before the first slash
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^\s*$/.test(url)) return url;
  return null;
}

function inline(escaped: string): string {
  const codes: string[] = [];
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = safeHref(url);
    if (!href) return m;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
  return s;
}

const FENCE = /^```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}\d+[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(escapeHtml(i))}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  };
  const flushQuote = (): void => {
    if (quote.length) {
      out.push(`<blockquote><p>${inline(escapeHtml(quote.join(" ")))}</p></blockquote>`);
      quote = [];
    }
  };
  const flushAll = (): void => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      const lang = fence[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    if (HR.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    const ul = UL.exec(line);
    if (ul) {
      flushPara();
      flushQuote();
      if (!list || list.tag !== "ul") {
        flushList();
        list = { tag: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = OL.exec(line);
    if (ol) {
      flushPara();
      flushQuote();
      if (!list || list.tag !== "ol") {
        flushList();
        list = { tag: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}
