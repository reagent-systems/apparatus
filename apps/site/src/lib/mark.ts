// The product mark: a still sphere of dots, after the orb. Used as the logo
// and the favicon, where a canvas cannot go.

export type Dot = { x: number; y: number; r: number; o: number };

/** `n` dots on a tilted Fibonacci sphere in a 32 × 32 box; nearer dots are larger and darker. */
export function markDots(n = 42): Dot[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const tilt = 0.45;
  const dots: Dot[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = 1 - (2 * (i + 0.5)) / n;
    const ring = Math.sqrt(1 - y0 * y0);
    const x = Math.cos(i * golden) * ring;
    const z0 = Math.sin(i * golden) * ring;
    const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
    const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
    const near = (z + 1) / 2;
    dots.push({
      x: +(16 + x * 13).toFixed(2),
      y: +(16 + y * 13).toFixed(2),
      r: +(0.55 + near * 0.95).toFixed(2),
      o: +(0.25 + near * 0.75).toFixed(2),
    });
  }
  return dots.sort((a, b) => a.r - b.r);
}
