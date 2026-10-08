// dist/bridge.js for the plain web build. Installs the default bridge when
// no shell has installed one. index.html loads it before the app module.

import { createWebBridge, type StringStorage } from "./bridge.ts";

if (!window.apparatusBridge) {
  let storage: StringStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  window.apparatusBridge = createWebBridge(storage);
}

export {};
