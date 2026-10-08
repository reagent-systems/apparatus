# @apparatus/design

The shared look of apparatus, as source CSS with no build step. `agent-kit/docs/DESIGN.md` is its law.

| File | Holds |
|---|---|
| `src/tokens.css` | The `dark` and `flat` custom variants; the `:root`, `.dark` and `:root[data-borders="off"]` token blocks; the `@theme inline` mapping |
| `src/fonts.css` | Inter Variable and JetBrains Mono Variable from fontsource. Each face lists its unicode range, so a browser fetches only the subsets a page draws: the latin files on `apps/web` and `apps/site` |

A consumer imports both after Tailwind:

```css
@import "tailwindcss";
@import "@apparatus/design/fonts.css";
@import "@apparatus/design/tokens.css";
```

Tailwind does not scan packages reached through `node_modules`. A consumer that renders markup from another workspace package adds an `@source` line for that package's `src/`.

`apps/web/test/borders.test.ts` checks the token blocks here.
