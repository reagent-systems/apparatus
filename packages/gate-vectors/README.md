# @apparatus/gate-vectors

`gate-vectors.json` holds 13 scenarios of synthetic audio and the events the web voice gate emits for them. It is generated; do not edit it by hand.

| Who | How |
|---|---|
| Writes it | `npm run gate-vectors -w apps/web` (`apps/web/scripts/gate-vectors.ts`) |
| Fails on drift | `apps/web/test/gate-vectors.test.ts` |
| Replays it | `apps/watchos/Tests/GateVectorTests.swift` (bundled by `apps/watchos/project.yml`), `apps/wearos` `GateVectorsTest.kt` (path from `app/build.gradle.kts`) |
