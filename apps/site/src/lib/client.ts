// The page's script: the theme and motion buttons, the video loops, the copy
// button, and the live orbs (lib/orb.ts).

import { onMotionChange, setUserPaused, still, userPaused } from "./motion.ts";
import "./orb.ts";

const root = document.documentElement;
const system = window.matchMedia("(prefers-color-scheme: dark)");

function store(value: "light" | "dark" | null) {
  try {
    if (value) localStorage.setItem("theme", value);
    else localStorage.removeItem("theme");
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}

function stored(): string | null {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
}

/**
 * The themed <picture>s (the orb stills) pick their dark source by
 * prefers-color-scheme, so the browser fetches one ink before any script runs.
 * When the page's theme differs from the system's, each dark source's media
 * becomes its width condition alone (`data-dark-media`) or `not all`.
 */
function pointPictures(dark: boolean) {
  for (const source of document.querySelectorAll<HTMLSourceElement>("source[data-dark-media]")) {
    const media = dark ? (source.dataset.darkMedia ?? "all") : "not all";
    if (source.media !== media) source.media = media;
  }
}

function applyTheme(dark: boolean, pictures = true) {
  root.classList.add("theme-switching");
  root.classList.toggle("dark", dark);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
    button.setAttribute("aria-pressed", String(dark));
  }
  // The browser chrome takes the page's colour, not only the system's.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = dark ? "#1b1917" : "#fbfaf7";
  }
  if (pictures) pointPictures(dark);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

// Following the system, the pictures already match: leave their media alone.
applyTheme(root.classList.contains("dark"), stored() !== null);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]")) {
  button.addEventListener("click", () => {
    const dark = !root.classList.contains("dark");
    // Picking what the system already shows goes back to following the system.
    store(dark === system.matches ? null : dark ? "dark" : "light");
    applyTheme(dark);
  });
}
system.addEventListener("change", (e) => {
  if (!stored()) applyTheme(e.matches);
});

// Pause motion: holds the orbs and the loops (WCAG 2.2.2). Reduced motion does the same.
const motionButtons = document.querySelectorAll<HTMLButtonElement>("[data-motion-toggle]");
const syncMotionButtons = () => {
  for (const button of motionButtons) {
    // The footer's text button names its next action; the hero's icon button is a toggle.
    if (button.dataset.motionToggle === "text") button.toggleAttribute("data-paused", userPaused());
    else button.setAttribute("aria-pressed", String(userPaused()));
  }
};
for (const button of motionButtons) button.addEventListener("click", () => setUserPaused(!userPaused()));
syncMotionButtons();

// Loops play while on screen and pause off it. The poster is set as a loop
// nears the screen; a hidden theme twin never intersects, so it loads
// nothing. While motion is held: the poster and the native controls.
const loops = [...document.querySelectorAll<HTMLVideoElement>("video[data-loop]")];
const near = new Set<HTMLVideoElement>();

function setPoster(video: HTMLVideoElement) {
  if (video.poster) return;
  const { poster, posterSmall } = video.dataset;
  const need = video.getBoundingClientRect().width * (window.devicePixelRatio || 1);
  video.poster = (posterSmall && need <= 480 ? posterSmall : poster) ?? "";
}

function setMotion() {
  syncMotionButtons();
  for (const video of loops) {
    video.controls = still();
    if (still()) video.pause();
    else if (near.has(video)) video.play().catch(() => undefined);
  }
}
onMotionChange(setMotion);
setMotion();

const observer = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) {
      const video = target as HTMLVideoElement;
      if (isIntersecting) {
        near.add(video);
        setPoster(video);
        if (!still()) video.play().catch(() => undefined);
      } else {
        near.delete(video);
        video.pause();
      }
    }
  },
  { rootMargin: "120px 0px" },
);
for (const video of loops) observer.observe(video);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy ?? "");
    if (!source) return;
    // One command a line, without the prompt.
    const lines = [...source.querySelectorAll<HTMLElement>("[data-command]")].map((l) => l.dataset.command ?? "");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      button.dataset.copied = "";
      window.setTimeout(() => delete button.dataset.copied, 1600);
    } catch {
      // No clipboard permission: the commands stay selectable.
    }
  });
}
