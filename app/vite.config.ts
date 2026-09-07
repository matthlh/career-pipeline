/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Two constraints shape this config, and both come from how the app is used.

   base: "./" - the built copy has to work at a GitHub Pages project path
   (/career-pipeline/) and at a file:// path, without being told which.

   format: "iife" plus the classicScript plugin below - a <script type="module">
   is blocked by CORS on file://, so a module build would mean the app could
   only ever be opened through a server. Opening the file directly is how it
   gets used on a bad day, so it is worth a plugin to keep. */
function classicScript() {
  return {
    name: "classic-script",
    transformIndexHtml(html: string) {
      /* data.example.js has a fixed name - index.html references it by hand -
         so nothing about it changes when its contents do, and Pages serves
         max-age=600. A visitor would spend ten minutes running new code against
         the previous demo data, which looks like a bug rather than a cache.
         data.js is deliberately not stamped: cron rewrites it between builds,
         so a build-time stamp there would pin the browser to stale real data. */
      const seed = join(process.cwd(), "public", "data.example.js");
      const v = existsSync(seed)
        ? createHash("sha256").update(readFileSync(seed)).digest("hex").slice(0, 8)
        : "0";
      html = html.replace('src="./data.example.js"', `src="./data.example.js?v=${v}"`);
      /* defer matters: a module script is deferred by the browser, a classic one
         in <head> is not, and running before <body> exists means createRoot has
         no #root to mount on. */
      return html.replace(/<script type="module" crossorigin src=/g, "<script defer src=")
                 .replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ');
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), classicScript()],
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      /* Hashed names, so a new build is picked up immediately rather than
         whenever the CDN feels like it. Only data.js and data.example.js keep
         fixed names, because index.html references them by hand and cron
         rewrites one of them between builds. */
      output: { format: "iife", entryFileNames: "assets/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
