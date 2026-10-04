// Layout and theme. One stylesheet, injected once. Breakpoints:
//   < 360px  watch class: feed only
//   < 768px  phone: feed + orb bar; the pane appears above the feed when it
//            has content, and the handoff view takes the whole screen
//   < 1024px tablet: pane left, feed right
//   >= 1024  desktop: feed left, large pane right

export const BREAKPOINTS = { watch: 360, tablet: 768, desktop: 1024 } as const;

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f5f2;
  --fg: #1c1b19;
  --muted: #6d6a64;
  --card: #ffffff;
  --card-edge: #e6e3dc;
  --accent: #2f6fed;
  --orb: #d8d4cb;
  --orb-listening: #2f6fed;
  --orb-speaking: #e0862a;
  --orb-working: #7a7f8a;
  --danger: #c43d2f;
  --radius: 14px;
  --gap: 12px;
  --bar-h: 112px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15151a;
    --fg: #ececec;
    --muted: #9a9aa3;
    --card: #1f1f26;
    --card-edge: #2c2c35;
    --orb: #3a3a45;
    --orb-working: #5d6270;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit;
  color: inherit;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: 999px;
  padding: 10px 20px;
  cursor: pointer;
}
button:active { transform: scale(0.98); }

.app {
  height: 100%;
  display: grid;
  grid-template-rows: 1fr auto;
  grid-template-columns: 1fr;
  grid-template-areas: "main" "bar";
}
.main {
  grid-area: main;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  gap: var(--gap);
  padding: var(--gap);
}
.feed {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}
.card {
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius);
  padding: 10px 14px;
  max-width: 44rem;
  overflow-wrap: anywhere;
}
.card p { margin: 0; }
.card p + p { margin-top: 6px; }
.card--user { align-self: flex-end; background: var(--accent); color: #fff; border-color: transparent; }
.card--agent { align-self: flex-start; }
.card--job .card__request { color: var(--muted); }
.card--job .card__progress:empty { display: none; }
.card__bar { height: 3px; margin-top: 8px; border-radius: 2px; background: var(--card-edge); width: 100%; }
.card__bar--set { background: var(--accent); transition: width 240ms; }
.card--done .card__request { font-size: 0.9em; }
.card--failed { border-color: var(--danger); }
.card--handoff { border-color: var(--orb-speaking); }
.card--credits { color: var(--muted); }
.card__action { font-weight: 600; }
.card__buttons { display: flex; gap: 8px; margin-top: 10px; }
.card__buttons button { padding: 6px 16px; }

.pane {
  position: relative;
  min-height: 0;
  background: var(--card);
  border: 1px solid var(--card-edge);
  border-radius: var(--radius);
  overflow: hidden;
  display: none;
}
.pane--content, .pane--handoff { display: block; }
.pane__content {
  height: 100%;
  overflow: auto;
  padding: 18px 22px;
}
.pane__content > :first-child { margin-top: 0; }
.pane__content pre { overflow: auto; padding: 12px; background: var(--bg); border-radius: 8px; }
.pane__content code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
.pane__content a { color: var(--accent); }
.pane--handoff .pane__content { display: none; }

.handoff {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  background: #000;
  outline: none;
}
.handoff__video { width: 100%; height: 100%; object-fit: contain; background: #000; touch-action: none; }
.handoff__bar {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 12px;
  background: var(--card);
}
.handoff__done { background: var(--accent); color: #fff; border-color: transparent; }

.bar {
  grid-area: bar;
  height: var(--bar-h);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  justify-items: center;
  padding: 0 var(--gap) env(safe-area-inset-bottom, 0);
  gap: var(--gap);
}
.bar__talk { justify-self: end; min-width: 88px; user-select: none; -webkit-user-select: none; touch-action: none; }
.bar__talk:active, .bar__talk--down { background: var(--accent); color: #fff; border-color: transparent; }
.bar__stop { justify-self: start; min-width: 88px; }

.orb {
  width: 72px;
  height: 72px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--orb);
  transition: background 200ms, transform 200ms, box-shadow 200ms;
}
.orb--away { opacity: 0.45; }
.orb--live { box-shadow: 0 0 0 4px var(--card-edge); }
.orb--listening { background: var(--orb-listening); transform: scale(1.08); box-shadow: 0 0 0 10px color-mix(in srgb, var(--orb-listening) 25%, transparent); }
.orb--speaking { background: var(--orb-speaking); animation: orb-pulse 900ms ease-in-out infinite; }
.orb--working { background: var(--orb-working); animation: orb-spin 2.4s linear infinite; }
@keyframes orb-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
@keyframes orb-spin {
  0% { box-shadow: 0 -8px 0 -2px var(--orb-working); }
  25% { box-shadow: 8px 0 0 -2px var(--orb-working); }
  50% { box-shadow: 0 8px 0 -2px var(--orb-working); }
  75% { box-shadow: -8px 0 0 -2px var(--orb-working); }
  100% { box-shadow: 0 -8px 0 -2px var(--orb-working); }
}
@media (prefers-reduced-motion: reduce) {
  .orb { animation: none !important; transition: none; }
}

/* phone: the handoff view takes the whole screen */
@media (max-width: ${BREAKPOINTS.tablet - 1}px) {
  .pane--content { max-height: 45vh; }
  .pane--handoff { position: fixed; inset: 0; z-index: 10; border: none; border-radius: 0; max-height: none; }
}

/* watch class: notifications only */
@media (max-width: ${BREAKPOINTS.watch - 1}px) {
  .app { grid-template-rows: 1fr; grid-template-areas: "main"; }
  .bar, .pane { display: none !important; }
  .main { padding: 6px; }
  .card { padding: 8px 10px; font-size: 0.95em; }
}

/* tablet: pane left, feed right */
@media (min-width: ${BREAKPOINTS.tablet}px) and (max-width: ${BREAKPOINTS.desktop - 1}px) {
  .main { grid-template-columns: 1.4fr 1fr; grid-template-rows: 1fr; grid-template-areas: "pane feed"; }
  .pane { grid-area: pane; display: block; }
  .feed { grid-area: feed; }
}

/* desktop: feed left, large pane right */
@media (min-width: ${BREAKPOINTS.desktop}px) {
  .main { grid-template-columns: minmax(320px, 1fr) 2.2fr; grid-template-rows: 1fr; grid-template-areas: "feed pane"; }
  .pane { grid-area: pane; display: block; }
  .feed { grid-area: feed; }
}
`;

export type LayoutParts = {
  feed: HTMLElement;
  pane: HTMLElement;
  orb: HTMLElement;
  talk: HTMLElement;
  stop: HTMLElement;
};

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function mountLayout(root: HTMLElement, parts: LayoutParts): void {
  injectStyles();
  root.className = "app";
  root.replaceChildren();

  const main = document.createElement("div");
  main.className = "main";
  main.append(parts.pane, parts.feed);

  const bar = document.createElement("div");
  bar.className = "bar";
  parts.talk.classList.add("bar__talk");
  parts.stop.classList.add("bar__stop");
  bar.append(parts.talk, parts.orb, parts.stop);

  root.append(main, bar);
}

export function isTabletWidth(): boolean {
  return window.innerWidth >= BREAKPOINTS.tablet;
}
