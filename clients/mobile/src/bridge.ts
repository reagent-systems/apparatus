// Mobile bridge. esbuild bundles this file to dist/bridge.js, which replaces
// the web build's bridge.js. index.html loads it before app.js, and app.js
// reads window.apparatusBridge at startup.
//
// The server origin is a build-time constant. esbuild replaces
// process.env.APPARATUS_SERVER_ORIGIN with a string literal
// (scripts/bridge.mjs). No runtime setting can change it.

import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";

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

function platform(): BridgePlatform {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : "web";
}

// Keychain on iOS, EncryptedSharedPreferences over the Android Keystore on
// Android (capacitor-secure-storage-plugin). A missing key rejects, so get()
// maps that to null.
const secureStore: ApparatusBridge["secureStore"] = {
  async get(key) {
    try {
      const { value } = await SecureStoragePlugin.get({ key });
      return value;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await SecureStoragePlugin.set({ key, value });
  },
  async delete(key) {
    try {
      await SecureStoragePlugin.remove({ key });
    } catch {
      // Removing a missing key rejects. The outcome is the same.
    }
  },
};

function stringMap(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof data !== "object" || data === null) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

// Android hands out an FCM token. iOS hands out the APNs device token.
// Without a Firebase config file (Android) or the push entitlement (iOS),
// registration fails and the result is null. The app then runs without push.
async function register(): Promise<{ platform: "fcm" | "apns"; token: string } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return null;

  const pushPlatform = platform() === "ios" ? "apns" : "fcm";
  const handles: PluginListenerHandle[] = [];
  const result = new Promise<{ platform: "fcm" | "apns"; token: string } | null>((resolve) => {
    let settled = false;
    const done = (value: { platform: "fcm" | "apns"; token: string } | null) => {
      if (settled) return;
      settled = true;
      for (const h of handles) void h.remove();
      resolve(value);
    };
    void PushNotifications.addListener("registration", (token) => {
      done({ platform: pushPlatform, token: token.value });
    }).then((h) => handles.push(h));
    void PushNotifications.addListener("registrationError", () => done(null)).then((h) => handles.push(h));
    PushNotifications.register().catch(() => done(null));
  });
  return result;
}

function onNotification(cb: (data: Record<string, string>) => void): void {
  void PushNotifications.addListener("pushNotificationReceived", (notification) => {
    cb(stringMap(notification.data));
  });
  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    cb(stringMap(action.notification.data));
  });
}

let nextNotificationId = 1;

async function notify(title: string, body: string): Promise<void> {
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
    perm = await LocalNotifications.requestPermissions();
  }
  if (perm.display !== "granted") return;
  await LocalNotifications.schedule({
    notifications: [{ id: nextNotificationId++, title, body }],
  });
}

async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`openExternal: refused scheme ${parsed.protocol}`);
  }
  await Browser.open({ url: parsed.href });
}

const bridge: ApparatusBridge = Object.freeze({
  platform: platform(),
  ...(serverOrigin ? { serverOrigin } : {}),
  secureStore: Object.freeze(secureStore),
  push: Object.freeze({ register, onNotification }),
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
