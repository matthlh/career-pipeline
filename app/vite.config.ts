/// <reference types="vitest/config" />
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
