// Boot: bridge, auth, device, theme, then the React tree.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";
import { getBridge, type BridgePlatform } from "./bridge.ts";
import { isTabletWidth } from "./hooks/use-breakpoint.ts";
import { installTheme } from "./lib/theme.ts";
import type { Device } from "./protocol.ts";
import { ServerProvider } from "./state/server.tsx";
import { VoiceProvider } from "./state/voice.tsx";

const AUTH_KEY = "apparatus.auth";

function detectDevice(platform: BridgePlatform): Device {
  if (platform === "desktop") return "desktop";
  if (platform === "ios" || platform === "android") return isTabletWidth() ? "tablet" : platform;
  return "web";
}

async function boot(): Promise<void> {
  installTheme();
  const bridge = getBridge();
  const auth = (await bridge.secureStore.get(AUTH_KEY)) ?? "dev";
  const httpOrigin = (bridge.serverOrigin ?? location.origin).replace(/\/+$/, "");
  const device = detectDevice(bridge.platform);
  const root = document.getElementById("app") ?? document.body.appendChild(document.createElement("div"));
  createRoot(root).render(
    <StrictMode>
      <ServerProvider bridge={bridge} auth={auth} device={device} httpOrigin={httpOrigin}>
        <VoiceProvider>
          <App />
        </VoiceProvider>
      </ServerProvider>
    </StrictMode>,
  );
}

void boot();
