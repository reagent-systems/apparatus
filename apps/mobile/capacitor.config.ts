import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "systems.reagent.apparatus",
  appName: "Apparatus",
  webDir: "dist",
  server: {
    // The web view origin is https://localhost. Cleartext stays off.
    androidScheme: "https",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
