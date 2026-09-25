import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// The dev server proxies to the Python app, so the browser talks to one
// origin and the token cookie works the same in development as in the
// built app that uvicorn serves itself.
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: "0.0.0.0",
    port: 5273,
    proxy: {
      "/api": { target: "http://127.0.0.1:8450", changeOrigin: false },
    },
  },
  resolve: {
    alias: [{ find: /^fs$/, replacement: fileURLToPath(new URL("./src/empty-module.ts", import.meta.url)) }],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // The spelling engine's loader calls `nanoid` as a function on a
      // namespace import, in `mountBuffer`, only when it is given no file
      // name; `hunspell-speller.ts` always gives one. Printed on every
      // build, the warning would hide the next real one (Q-036). Only that
      // warning, from that module, is dropped.
      onwarn(warning, warn) {
        if (warning.code === "CANNOT_CALL_NAMESPACE" && warning.id?.includes("emscripten-wasm-loader")) return;
        warn(warning);
      },
    },
  },
});
