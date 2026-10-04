// Desktop bridge. esbuild bundles this file to dist/bridge.js, which replaces
// the web build's bridge.js. index.html loads it before app.js, and app.js
// reads window.apparatusBridge at startup.
//
// The server origin is a build-time constant. esbuild replaces
// process.env.APPARATUS_SERVER_ORIGIN with a string literal
// (scripts/bridge.mjs). No runtime setting can change it.

import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

type BridgePlatform = "web" | "desktop" | "ios" | "android";

interface ApparatusBridge {
  platform: BridgePlatform;
  serverOrigin?: string;
  secureStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  push?: {
    register(): Promise<{ platform: "fcm" | "apns" | "web"; token: string } | null>;
    onNotification(cb: (data: Record<string, string>) => void): void;
  };
  notify?: (title: string, body: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    apparatusBridge?: ApparatusBridge;
  }
}

const serverOrigin = process.env.APPARATUS_SERVER_ORIGIN;

// Each command maps to one keyring entry under the "apparatus" service
// (src-tauri/src/lib.rs). The OS keychain holds the value; the web view never
// sees a file or a database.
const secureStore: ApparatusBridge["secureStore"] = {
  get: (key) => invoke<string | null>("keychain_get", { key }),
  set: (key, value) => invoke<void>("keychain_set", { key, value }),
  delete: (key) => invoke<void>("keychain_delete", { key }),
};

async function notify(title: string, body: string): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return;
  sendNotification({ title, body });
}

async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`openExternal: refused scheme ${parsed.protocol}`);
  }
  await openUrl(parsed.href);
}

const bridge: ApparatusBridge = Object.freeze({
  platform: "desktop",
  ...(serverOrigin ? { serverOrigin } : {}),
  secureStore: Object.freeze(secureStore),
  notify,
  openExternal,
});

Object.defineProperty(window, "apparatusBridge", {
  value: bridge,
  writable: false,
  configurable: false,
  enumerable: true,
});

export {};
