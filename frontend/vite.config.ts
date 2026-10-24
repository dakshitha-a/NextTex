import { cpSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// What pdf.js fetches by URL rather than imports: the WebAssembly image
// decoders and colour management, the CJK character maps and the standard
// fonts. Copied whole into `dist/assets/pdfjs/`, where `pdfSource` in
// `src/panes/pdf-worker.ts` points pdf.js; without them a scanned page is
// drawn blank. The development server serves them from `node_modules`.
function pdfjsData(): Plugin {
  const folders = ["wasm", "cmaps", "standard_fonts", "iccs"];
  return {
    name: "nexttex-pdfjs-data",
    apply: "build",
    writeBundle(options) {
      const from = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
      for (const folder of folders) {
        cpSync(`${from}${folder}`, `${options.dir}/assets/pdfjs/${folder}`, { recursive: true });
      }
    },
  };
}

// KaTeX for the pages the agent publishes, at a fixed address, since a page
// is written before any build and cannot know a hashed name: the script,
// its styles, the auto-render and chemistry extensions, and the woff2
// fonts, which every browser the app supports takes. `nexttex/page_parts.py`
// writes the tags; `nexttex/pages.py` lets a page load from here. The
// development server serves the same paths from `node_modules`.
function katexForPages(): Plugin {
  const files = ["katex.min.js", "katex.min.css", "contrib/auto-render.min.js", "contrib/mhchem.min.js"];
  const from = fileURLToPath(new URL("./node_modules/katex/dist/", import.meta.url));
  return {
    name: "nexttex-katex-for-pages",
    configureServer(server) {
      server.middlewares.use("/assets/katex/", (request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(/^\/+/, "");
        if (path.includes("..")) return next();
        try {
          response.setHeader("access-control-allow-origin", "*");
          response.end(readFileSync(`${from}${path}`));
        } catch {
          next();
        }
      });
    },
    writeBundle(options) {
      const to = `${options.dir}/assets/katex/`;
      for (const file of files) cpSync(`${from}${file}`, `${to}${file}`);
      for (const font of readdirSync(`${from}fonts`).filter((name) => name.endsWith(".woff2"))) {
        cpSync(`${from}fonts/${font}`, `${to}fonts/${font}`);
      }
    },
  };
}

// The dev server proxies to the Python app, so the browser talks to one
// origin and the token cookie works the same in development as in the
// built app that uvicorn serves itself.
export default defineConfig({
  plugins: [react(), tailwind(), pdfjsData(), katexForPages()],
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
    // Rolldown's options since Vite 8, which bundles with Rolldown where it
    // used Rollup; `rollupOptions` is kept by a shim that may go.
    rolldownOptions: {
      // The spelling engine's loader calls `nanoid` as a function on a
      // namespace import, in `mountBuffer`, only when it is given no file
      // name; `hunspell-speller.ts` always gives one. Printed on every
      // build, the warning would hide the next real one (Q-036). Only that
      // warning, from that module, is dropped. Rolldown names it with the
      // code Rollup did.
      onwarn(warning, warn) {
        if (warning.code === "CANNOT_CALL_NAMESPACE" && warning.id?.includes("emscripten-wasm-loader")) return;
        warn(warning);
      },
    },
  },
});
