# Third-party notices

This file lists third-party code that the apparatus repository copies or ports into its own
source tree. Dependencies installed by a package manager (`uv.lock`, `package-lock.json`,
Gradle, Cargo) carry their own licenses and are not listed here.

## thinking-orbs

| | |
|---|---|
| Project | thinking-orbs, npm 0.3.2 |
| Author | Jakub Antalik |
| Upstream | https://github.com/Jakubantalik/Libraries.dev, `packages/thinking-orbs`, commit `0d448879917f92c2b9f2773c1f91054f4c83dae5` |
| License | MIT |

Where it is used:

| Path | Form |
|---|---|
| `apps/watchos/Vendor/ThinkingOrbsKit/` | The upstream Swift port (`ports/ios/ThinkingOrbsKit`), its spec files and its golden test, vendored with 2 edits. `VENDORED.md` lists the files and the edits. The license is `LICENSE` in that folder. |
| `apps/wearos/app/src/main/java/systems/reagent/apparatus/wear/ui/orb/engine/` | A Kotlin port of the engine. Each file names its upstream source. The APK ships the license as `META-INF/thinking-orbs-LICENSE.txt`. |
| `apps/wearos/app/src/test/resources/thinking-orbs/` | Upstream `spec/orbs-golden.json` and `LICENSE`, for `OrbGoldenTest`. |

The web client installs the same library from npm through the orb renderer (`packages/orb/package.json`).

```
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Primer Octicons

| | |
|---|---|
| Project | Primer Octicons, `mark-github` 16 |
| Author | GitHub, Inc. |
| Upstream | https://github.com/primer/octicons |
| License | MIT |

Where it is used:

| Path | Form |
|---|---|
| `apps/site/src/components/GithubMark.astro` | The `mark-github` path, inline, on the links to the repository. |

```
MIT License

Copyright (c) 2023 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Lucide

| | |
|---|---|
| Project | Lucide, npm `lucide-react` 1.52.0 |
| Author | Lucide Icons and Contributors; 7 of the icons below derive from Feather by Cole Bemis |
| Upstream | https://github.com/lucide-icons/lucide |
| License | ISC; the Feather-derived icons also MIT |

Where it is used:

| Path | Form |
|---|---|
| `apps/site/src/lib/icons.ts` | The SVG nodes of 12 icons: arrow-right, arrow-up-right, check, copy, moon, sun, pause, play, globe, monitor, smartphone, watch. `Icon.astro` draws them. arrow-right, arrow-up-right, check, monitor, moon, smartphone and sun derive from Feather. |

The web client installs `lucide-react` from npm (`apps/web/package.json`).

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

```
The MIT License (MIT) (for the Feather-derived icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
