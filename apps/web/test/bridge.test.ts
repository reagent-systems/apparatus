import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebBridge, getBridge } from "../src/bridge.ts";

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

test("the default web bridge round-trips through the given storage", async () => {
  const storage = new FakeStorage();
  const bridge = createWebBridge(storage);
  assert.equal(bridge.platform, "web");
  assert.equal(bridge.serverOrigin, undefined);
  assert.equal(bridge.push, undefined);
  assert.equal(bridge.notify, undefined);
  assert.equal(await bridge.secureStore.get("apparatus.auth"), null);
  await bridge.secureStore.set("apparatus.auth", "dev-user");
  assert.equal(storage.getItem("apparatus.auth"), "dev-user");
  assert.equal(await bridge.secureStore.get("apparatus.auth"), "dev-user");
  await bridge.secureStore.delete("apparatus.auth");
  assert.equal(await bridge.secureStore.get("apparatus.auth"), null);
});

test("a throwing storage is tolerated", async () => {
  const broken = {
    getItem(): string | null {
      throw new Error("blocked");
    },
    setItem(): void {
      throw new Error("blocked");
    },
    removeItem(): void {
      throw new Error("blocked");
    },
  };
  const bridge = createWebBridge(broken);
  await bridge.secureStore.set("k", "v");
  assert.equal(await bridge.secureStore.get("k"), null);
  await bridge.secureStore.delete("k");
});

test("getBridge falls back to the web bridge without a window", () => {
  const b = getBridge();
  assert.equal(b.platform, "web");
});
