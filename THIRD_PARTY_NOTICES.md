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
| `clients/watchos/Vendor/ThinkingOrbsKit/` | The upstream Swift port (`ports/ios/ThinkingOrbsKit`), its spec files and its golden test, vendored with 2 edits. `VENDORED.md` lists the files and the edits. The license is `LICENSE` in that folder. |
| `clients/wearos/app/src/main/java/systems/reagent/apparatus/wear/ui/orb/engine/` | A Kotlin port of the engine. Each file names its upstream source. The APK ships the license as `META-INF/thinking-orbs-LICENSE.txt`. |
| `clients/wearos/app/src/test/resources/thinking-orbs/` | Upstream `spec/orbs-golden.json` and `LICENSE`, for `OrbGoldenTest`. |

The web client installs the same library from npm (`web/package.json`).

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
