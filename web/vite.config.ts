// Vite: the React app. `npm run dev` proxies the server's HTTP and WebSocket
// routes to a session server on port 8080 and serves /bridge.js and
// /worklet.js from esbuild, the way build.mjs emits them. `build.mjs` calls
// build() and then adds the two files to dist/.

import { build as esbuild } from "esbuild";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SERVER = "http://localhost:8080";
const HTTP_ROUTES = ["/token", "/credits", "/audit", "/jobs", "/config", "/prompts"];
const here = fileURLToPath(new URL(".", import.meta.url));

const PLAIN_SCRIPTS: Record<string, { entry: string; format: "esm" | "iife" }> = {
  "/worklet.js": { entry: "src/audio/worklet.ts", format: "esm" },
  "/bridge.js": { entry: "src/bridge-web.ts", format: "iife" },
};

function plainScripts(): Plugin {
  return {
    name: "apparatus-plain-scripts",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        const script = PLAIN_SCRIPTS[path];
        if (!script) return next();
        esbuild({
          absWorkingDir: here,
          entryPoints: [script.entry],
          bundle: true,
          write: false,
          format: script.format,
          target: "es2022",
        })
          .then((result) => {
            res.setHeader("Content-Type", "text/javascript");
            res.end(result.outputFiles[0].text);
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), plainScripts()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      ...Object.fromEntries(HTTP_ROUTES.map((route) => [route, { target: SERVER, changeOrigin: true }])),
      "/ws": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
});
