// The seam between the web app and a native shell (Tauri 2 desktop,
// Capacitor iOS/Android). A shell replaces dist/bridge.js with its own
// module that assigns `window.apparatusBridge` before the app module runs. Types
// only here; no DOM access at module level.

export type BridgePlatform = "web" | "desktop" | "ios" | "android";

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type PushRegistration = { platform: "fcm" | "apns" | "web"; token: string };

export interface BridgePush {
  register(): Promise<PushRegistration | null>;
  onNotification(cb: (data: Record<string, string>) => void): void;
}

export interface ApparatusBridge {
  platform: BridgePlatform;
  /** Base URL of the session server, baked in by a native shell at build
   *  time. Undefined on the web: the page origin is the server. No UI
   *  changes it. */
  serverOrigin?: string;
  secureStore: SecureStore;
  push?: BridgePush;
  notify?: (title: string, body: string) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    apparatusBridge?: ApparatusBridge;
  }
}

/** A Storage-shaped object: `localStorage` or a test double. */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The default web bridge. Every storage call is wrapped: private mode and
 *  blocked site data make `localStorage` throw. */
export function createWebBridge(storage: StringStorage | null): ApparatusBridge {
  return {
    platform: "web",
    secureStore: {
      async get(key) {
        try {
          return storage ? storage.getItem(key) : null;
        } catch {
          return null;
        }
      },
      async set(key, value) {
        try {
          storage?.setItem(key, value);
        } catch {
          // storage unavailable: the value lives for this page only
        }
      },
      async delete(key) {
        try {
          storage?.removeItem(key);
        } catch {
          // nothing to remove
        }
      },
    },
  };
}

/** The shell's bridge when one is installed, else the web default. */
export function getBridge(): ApparatusBridge {
  const w = globalThis as typeof globalThis & { window?: Window };
  const installed = w.window?.apparatusBridge;
  if (installed) return installed;
  let storage: StringStorage | null = null;
  try {
    storage = (globalThis as { localStorage?: StringStorage }).localStorage ?? null;
  } catch {
    storage = null;
  }
  return createWebBridge(storage);
}
