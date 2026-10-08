# ThinkingOrbsKit, vendored

The Swift port of thinking-orbs, the orb library the web client ships (npm
`thinking-orbs` 0.3.2, MIT, by Jakub Antalik). The watch draws its orb with
it.

| | |
|---|---|
| Upstream | https://github.com/Jakubantalik/Libraries.dev |
| Path | `packages/thinking-orbs/ports/ios/ThinkingOrbsKit` (package), `packages/thinking-orbs/spec` (spec files), `packages/thinking-orbs/LICENSE` |
| Commit | `0d448879917f92c2b9f2773c1f91054f4c83dae5` |
| License | MIT, `LICENSE` in this folder |

The engine at that commit is the one npm ships as 0.3.2: its golden vectors
(`spec/orbs-golden.json`) match the installed `node_modules/thinking-orbs`
engine on all 72 cases, and `Sources/ThinkingOrbsKit/OrbSpec.swift` is
byte-identical to a fresh `scripts/codegen-swift.ts` run on
`spec/orbs-spec.json`. The golden file's `sourceLibrary` says 0.3.1; the
upstream `package.json` says 0.3.2.

## Files

| Here | Upstream |
|---|---|
| `Package.swift` | `ports/ios/ThinkingOrbsKit/Package.swift`, edited |
| `Sources/ThinkingOrbsKit/*.swift` | `ports/ios/ThinkingOrbsKit/Sources/ThinkingOrbsKit/`, unchanged, without `Snapshot.swift` |
| `Tests/ThinkingOrbsKitTests/OrbGoldenTests.swift` | `ports/ios/ThinkingOrbsKit/Tests/ThinkingOrbsKitTests/OrbGoldenTests.swift`, edited |
| `spec/orbs-golden.json` | `spec/orbs-golden.json`, sha256 `70bfaa2bbf1390b63f6ec02f16d7a4329fee67b3b290e671fe1d205328165e20` |
| `spec/orbs-spec.json` | `spec/orbs-spec.json`, sha256 `8199c13bff7e9124883524b84f489ef2256693a4fdcf743de5082b8c9f0604eb` |
| `LICENSE` | `LICENSE` |

Left out: `Snapshot.swift` and `OrbSnapshotTests.swift` (an `ImageRenderer`
PNG harness; the source compiles to nothing on watchOS), and
`OrbPerformanceTests.swift`.

## Edits

1. `Package.swift`: `.watchOS(.v10)` added to `platforms`. Without it SwiftPM
   builds for its default watchOS minimum, where `Canvas` and `TimelineView`
   do not exist. `swift-tools-version` raised from 5.9 to 5.10, so Xcode 15.0
   to 15.2 stop at a clear tools-version error instead of a syntax error in
   `Presets.swift` (see "Toolchain").
2. `OrbGoldenTests.swift`: the golden file is read from this package's
   `spec/` folder (three levels up from the test file) instead of the
   upstream repository root (six levels up).

No source file of the kit is edited. The watch app (`Sources/UI/OrbView.swift`)
drives the clock itself through the kit's public `orbFrozenTime(_:)`, so the
static frame is raw engine time 0.6 as on the web (the kit's own
reduced-motion and `paused` path draws 0.6 × the preset speed instead), and a
paused orb holds the frame on screen, as the web's canvas does.

## Toolchain

`Presets.swift` declares its cache `nonisolated(unsafe)` (SE-0412), which
Swift 5.9 rejects: the kit needs Swift 5.10, Xcode 15.3 or later.
`Package.swift` declares tools version 5.10 to enforce that floor.

## Updating

Copy the files above from a new upstream commit, apply the two edits, update
the commit and hashes here, and run the golden test:

```sh
cd apps/watchos/Vendor/ThinkingOrbsKit
xcodebuild test -scheme ThinkingOrbsKit -destination 'platform=watchOS Simulator,name=<a watch simulator>'
```

On macOS, `swift test` in this folder runs it without a simulator. On Linux,
`ThinkingOrb.swift` cannot build (it imports SwiftUI); a scratch package
that symlinks the other sources, the test and `spec/` runs the golden test
there (`../../README.md`, "Checked without Xcode").
