# @apparatus/orb

The orb renderer, shared by `apps/web` and `apps/site`. TypeScript source with no build step: Vite compiles it in each app, and Node runs the tests on the raw `.ts` files.

| File | Holds |
|---|---|
| `src/OrbCanvas.tsx` | The thinking-orbs canvas at its real size (backing store `size` × DPR, capped at 2) |
| `src/orb-paint.ts` | The drawing: the library's preset, frames and painter, scaled to the displayed size; the `OrbAnimation` names |
| `src/orb-clock.ts` | One clock for every orb on the page |
| `src/use-reduced-motion.ts` | `prefers-reduced-motion` as a React value |

`apps/site` imports only `@apparatus/orb/paint` and `@apparatus/orb/clock`: a plain script draws its orbs, and its build draws the static frame as SVG with the same painter.

The voice switch around it (`Orb.tsx`, `OrbMini.tsx`, `use-orb-control.ts`) and the voice state mapping (`src/orb-state.ts`) stay in `apps/web`.

```sh
npm test -w @apparatus/orb        # orb-paint and orb-clock tests
npm run typecheck -w @apparatus/orb
```

The orb engine is npm `thinking-orbs` 0.3.2 (MIT); the notice is in `THIRD_PARTY_NOTICES.md`. Relative imports carry the `.ts` extension and no `@/` alias, because the files are compiled from other workspaces.
