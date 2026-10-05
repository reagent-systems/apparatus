// Boot: bridge, auth, theme and borders, device, then the React tree. Providers mount in
// the contract order: Theme > Server > Voice > Feed > Selection > Screen.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";
import { getBridge, type BridgePlatform } from "./bridge.ts";
import { ThemeProvider, readStoredBorders, readStoredTheme } from "./components/theme/ThemeProvider.tsx";
import { isTabletWidth } from "./hooks/use-breakpoint.ts";
import type { Device } from "./protocol.ts";
import { FeedProvider } from "./state/feed.tsx";
import { ScreenProvider } from "./state/screen.tsx";
import { SelectionProvider } from "./state/selection.tsx";
import { ServerProvider } from "./state/server.tsx";
import { VoiceProvider } from "./state/voice.tsx";

const AUTH_KEY = "apparatus.auth";

function detectDevice(platform: BridgePlatform): Device {
  if (platform === "desktop") return "desktop";
  if (platform === "ios" || platform === "android") return isTabletWidth() ? "tablet" : platform;
  return "web";
}

async function boot(): Promise<void> {
  const bridge = getBridge();
  if (bridge.platform === "desktop" && navigator.platform.startsWith("Mac")) {
    document.documentElement.classList.add("tauri-mac");
  }
  const [auth, theme, borders] = await Promise.all([bridge.secureStore.get(AUTH_KEY), readStoredTheme(bridge), readStoredBorders(bridge)]);
  const httpOrigin = (bridge.serverOrigin ?? location.origin).replace(/\/+$/, "");
  const device = detectDevice(bridge.platform);
  const root = document.getElementById("app") ?? document.body.appendChild(document.createElement("div"));
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider bridge={bridge} initial={theme} initialBorders={borders}>
        <ServerProvider bridge={bridge} auth={auth ?? "dev"} device={device} httpOrigin={httpOrigin}>
          <VoiceProvider>
            <FeedProvider>
              <SelectionProvider>
                <ScreenProvider>
                  <App />
                </ScreenProvider>
              </SelectionProvider>
            </FeedProvider>
          </VoiceProvider>
        </ServerProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void boot();
