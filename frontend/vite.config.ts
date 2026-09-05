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
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
