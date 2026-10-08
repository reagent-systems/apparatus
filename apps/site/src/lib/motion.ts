// Motion on the page: the orbs and the loops move unless the system asks for
// reduced motion or the viewer pressed Pause motion in the header. The
// choice is `data-motion="paused"` on <html>, set before first paint by the
// inline script in Base.astro and kept in localStorage.

const root = document.documentElement;
export const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

export const userPaused = (): boolean => root.dataset.motion === "paused";

/** True when nothing on the page may move. */
export const still = (): boolean => reduce.matches || userPaused();

export function setUserPaused(paused: boolean): void {
  if (paused) root.dataset.motion = "paused";
  else delete root.dataset.motion;
  try {
    if (paused) localStorage.setItem("motion", "paused");
    else localStorage.removeItem("motion");
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/** Calls `fn` when the system setting or the viewer's choice changes. */
export function onMotionChange(fn: () => void): void {
  reduce.addEventListener("change", fn);
  new MutationObserver(fn).observe(root, { attributes: true, attributeFilter: ["data-motion"] });
}
