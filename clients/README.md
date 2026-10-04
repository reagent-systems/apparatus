# Clients

Native shells around the web client in `web/`, plus 2 native watch apps. Each shell builds `web/dist`, copies it into its own `dist/`, and replaces `bridge.js` with its own build of `src/bridge.ts`. The web app reads `window.apparatusBridge` at startup and gets the OS keychain, notifications, push, and the session server origin from it. The watch apps run no web view: they speak the same protocol natively, with push to talk and notifications only (`clients/watchos/README.md`, `clients/wearos/README.md`).

| Platform | Shell | Build command | CI job | Artifact |
|---|---|---|---|---|
| Linux (deb, AppImage, rpm) | `clients/desktop` (Tauri 2) | `npm run build` | `clients-desktop` / `ubuntu-22.04` | `desktop-ubuntu-22.04` |
| Windows (msi, nsis) | `clients/desktop` (Tauri 2) | `npm run build` | `clients-desktop` / `windows-latest` | `desktop-windows-latest` |
| macOS (dmg, universal) | `clients/desktop` (Tauri 2) | `npm run build -- --target universal-apple-darwin` | `clients-desktop` / `macos-latest` | `desktop-macos-latest` |
| Android (apk) | `clients/mobile` (Capacitor 6) | `npm run prepare-dist && npx cap sync android && cd android && ./gradlew assembleDebug` | `clients-mobile` / `android` | `mobile-android` |
| iOS (simulator app, ipa) | `clients/mobile` (Capacitor 6) | `npm run prepare-dist && npx cap sync ios`, then build in Xcode | `clients-mobile` / `ios` | `mobile-ios` |
| watchOS (xcarchive, ipa) | `clients/watchos` (SwiftUI, XcodeGen) | `xcodegen generate && xcodebuild -scheme ApparatusWatch build` | `clients-watchos` | `watchos` |
| Wear OS (apk) | `clients/wearos` (Kotlin, Compose for Wear OS) | `gradle assembleDebug` | `clients-wearos` | `wearos` |

## Rules both shells follow

- The session server origin is fixed at build time. `APPARATUS_SERVER_ORIGIN` (default `http://localhost:8080`) is baked into `dist/bridge.js` as `serverOrigin`. There is no runtime setting for any endpoint (design spec, Security rule 9).
- Tokens go through `secureStore` into the OS keychain. The web view never writes them to a file or a database.
- Push tokens are registered through `bridge.push.register()` and sent as `C2S.push.register`. Desktop has no push; the server reaches it over the WebSocket, and `notify` shows a local notification.
- `openExternal` opens `http` and `https` URLs only.

## Bridge contract

```ts
type BridgePlatform = "web" | "desktop" | "ios" | "android";
interface ApparatusBridge {
  platform: BridgePlatform;
  serverOrigin?: string;
  secureStore: { get(key): Promise<string | null>; set(key, value): Promise<void>; delete(key): Promise<void> };
  push?: { register(): Promise<{ platform: "fcm" | "apns" | "web"; token: string } | null>; onNotification(cb): void };
  notify?: (title: string, body: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}
```

`index.html` loads `./bridge.js` as a module before `./app.js`. Each shell freezes the bridge object and defines `window.apparatusBridge` as read-only.

## Desktop: Tauri 2

Files: `clients/desktop/src/bridge.ts`, `clients/desktop/scripts/*.mjs`, `clients/desktop/src-tauri/`.

The Rust side (`src-tauri/src/lib.rs`) adds 3 commands: `keychain_get`, `keychain_set`, `keychain_delete`. They use the `keyring` crate with service `apparatus`: Keychain on macOS, Credential Manager on Windows, Secret Service over D-Bus on Linux. The notification and opener plugins cover `notify` and `openExternal`.

### Prerequisites

- Node 22 and npm.
- Rust stable (`rustup`). `src-tauri/Cargo.toml` sets `rust-version = "1.77.2"`.
- Linux build: `sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev build-essential libssl-dev`.
- Linux runtime: WebKitGTK 2.40 or newer with GStreamer, or `getUserMedia` fails. Install `libwebkit2gtk-4.1-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-pulseaudio gstreamer1.0-pipewire`. The keychain needs a running Secret Service (GNOME Keyring or KWallet).
- macOS: Xcode command line tools. `src-tauri/Info.plist` carries `NSMicrophoneUsageDescription`. `src-tauri/Entitlements.plist` carries `com.apple.security.device.audio-input`, which the Hardened Runtime needs for the microphone.
- Windows: WebView2 (part of Windows 10 and 11). The nsis and msi bundles install it when it is missing.

### Dev run

```sh
cd web && npm ci && cd ../clients/desktop && npm ci
npm run dev
```

`npm run dev` writes `src-tauri/gen/server.conf.json`, then runs `tauri dev --config` with it. `tauri dev` runs `npm run prepare-dist` first. That script builds `web/`, copies `web/dist` to `dist/`, and bundles the bridge. It also generates `src-tauri/icons` from `src-tauri/app-icon.png` when `icon.png` is missing.

### Build

```sh
APPARATUS_SERVER_ORIGIN=https://session.example.com npm run build
```

Bundles land in `src-tauri/target/release/bundle/`. The origin lands in 2 places: `dist/bridge.js` and the CSP `connect-src` in `src-tauri/gen/server.conf.json`. The base CSP in `src-tauri/tauri.conf.json` allows `'self'`, `ipc:`, `http://ipc.localhost` and `generativelanguage.googleapis.com` over https and wss.

For `cargo check` without a web build: `npm run icons`, then put any `index.html` in `dist/`.

### CI

`.github/workflows/clients-desktop.yml` builds on `ubuntu-22.04`, `windows-latest` and `macos-latest` with `tauri-apps/tauri-action@v0`. It uploads bundles only; it makes no release. Set the repository variable `APPARATUS_SERVER_ORIGIN` for a non-local server. Signing secrets are optional: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Without them the macOS bundle is unsigned and the Windows bundle is unsigned.

### Verified in the sandbox that wrote this

- `cargo check` on Linux with `libwebkit2gtk-4.1-dev` and `libdbus-1-dev`: 0 warnings.
- `npx tauri build --debug --no-bundle --config src-tauri/gen/server.conf.json` on Linux. It ran `npm run prepare-dist` against the real `web/dist` and built `target/debug/apparatus-desktop`.
- `npx tsc --noEmit` on `src/bridge.ts`.

### Unverified in the sandbox that wrote this

- No macOS, no Windows. The macOS and Windows builds, the Keychain and Credential Manager paths, and the Hardened Runtime entitlement ran in no build.
- Microphone permission prompts on WebKitGTK and WebView2 ran in no build.

## Mobile: Capacitor 6

Files: `clients/mobile/src/bridge.ts`, `clients/mobile/scripts/*.mjs`, `clients/mobile/capacitor.config.ts`, `clients/mobile/android/`, `clients/mobile/ios/`.

`android/` and `ios/` are committed, as Capacitor expects. `npx cap sync` copies `dist/` into them and updates plugins. The sync outputs (`public/`, `capacitor.config.json`, Pods) are ignored by git.

### Plugins

| Need | Plugin | Note |
|---|---|---|
| Keychain / Keystore | `capacitor-secure-storage-plugin@0.10` | The 0.10 line peers on `@capacitor/core@^6`. iOS: Keychain. Android: `EncryptedSharedPreferences` keyed by the Android Keystore. |
| Push | `@capacitor/push-notifications@6` | Android: FCM token, `platform: "fcm"`. iOS: APNs device token, `platform: "apns"`. |
| Local notifications | `@capacitor/local-notifications@6` | `notify`. |
| External URL | `@capacitor/browser@6` | `openExternal`. |

Capacitor 8 is the current major on npm. This shell pins 6 and Java 17. A move to 8 needs Java 21, `cap migrate`, and a check of every plugin version.

### Prerequisites

- Node 22 and npm.
- Android: JDK 17, Android SDK with platform 34 and build-tools 34. Android Studio for `npx cap open android`.
- iOS: macOS, Xcode 15 or newer, CocoaPods. `npx cap sync ios` runs `pod install`.
- Push on Android: `android/app/google-services.json` from Firebase. The file is not in git. Without it `android/app/build.gradle` skips the google-services plugin and `register()` resolves `null`.
- Push on iOS: an App ID with the Push Notifications capability and a provisioning profile that carries `aps-environment`. `ios/App/App/App.entitlements` requests it; `project.pbxproj` points `CODE_SIGN_ENTITLEMENTS` at it. `ios/App/App/GoogleService-Info.plist` is not in git and is only needed when Firebase is added to the iOS app.

### Platform patches in git

- `android/app/src/main/AndroidManifest.xml`: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`; `android:usesCleartextTraffic="false"`. A device build therefore needs an `https` server origin. `http://localhost:8080` works in no Android build.
- `ios/App/App/Info.plist`: `NSMicrophoneUsageDescription`; `UIBackgroundModes` with `audio` and `remote-notification`.
- `ios/App/App/AppDelegate.swift`: the 2 APNs callbacks that `@capacitor/push-notifications` requires.
- `ios/ExportOptions.plist`: `app-store-connect`, manual signing. CI fills `teamID` and `provisioningProfiles` from the profile.

Android WebView microphone: `BridgeWebChromeClient.onPermissionRequest` in `@capacitor/android` handles it. When the page calls `getUserMedia`, it asks for `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` at runtime. On grant it passes `AUDIO_CAPTURE` to the web view. No code in this shell handles it.

### Dev run

```sh
cd web && npm ci && cd ../clients/mobile && npm ci
npm run prepare-dist
npx cap sync
npx cap open android   # or: npx cap open ios
```

Run from Android Studio or Xcode. For a device, set `APPARATUS_SERVER_ORIGIN` to an `https` origin before `prepare-dist`.

### Build

```sh
APPARATUS_SERVER_ORIGIN=https://session.example.com npm run prepare-dist
npx cap sync android && (cd android && ./gradlew assembleDebug)
npx cap sync ios && xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

### CI

`.github/workflows/clients-mobile.yml` has 2 jobs.

- `android` on `ubuntu-latest`: Temurin 17, `assembleDebug`. With `ANDROID_GOOGLE_SERVICES_JSON` it writes `google-services.json`. With `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` it also builds and signs `assembleRelease`. Artifact `mobile-android` holds the apk files.
- `ios` on `macos-latest`: simulator build with `CODE_SIGNING_ALLOWED=NO`. With `IOS_P12_BASE64`, `IOS_P12_PASSWORD` and `IOS_PROVISIONING_PROFILE_BASE64` it also exports an IPA. It imports the certificate into a temporary keychain, sets manual signing on the App target, archives, and exports with `ios/ExportOptions.plist`. The P12 must hold an Apple Distribution certificate. With `IOS_GOOGLE_SERVICE_PLIST` it writes `GoogleService-Info.plist`. Artifact `mobile-ios` holds the simulator `App.app` and any IPA.

### Verified in the sandbox that wrote this

- `npm run prepare-dist` against the real `web/dist`, `npx cap sync android`, and `./gradlew assembleDebug` with SDK platform 34 and build-tools 34.0.0. The APK holds the 4 permissions, `usesCleartextTraffic="false"`, and this shell's `bridge.js`.
- `npx tsc --noEmit` on `src/bridge.ts` and `capacitor.config.ts`.

### Unverified in the sandbox that wrote this

- No macOS and no Xcode. `cap add ios` ran on Linux and skipped `pod install`. The `App.xcworkspace` contents file appears after the first `pod install`. The `project.pbxproj` edit, the entitlements, and the IPA export ran in no build.
