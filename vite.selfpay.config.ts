import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The customer pay page as ONE self-contained HTML file a website can host itself (owner 2026-11-17: "our original customer
// pay page, same UI and design"). Everything (code, styles, fonts, logos, help pictures) is inlined: the file needs nothing
// from PayTrace's address. scripts/inline-selfpay.mjs then puts the script and styles into the HTML itself and writes
// dist/selfpay/pay-page.html, which the dashboard's "Pay page code" page offers for download.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "dashboard",
  publicDir: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("./dashboard/src", import.meta.url)) },
  },
  build: {
    outDir: "../dist-selfpay",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      maxParallelFileOps: 20,
      input: fileURLToPath(new URL("./dashboard/selfpay/index.html", import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
