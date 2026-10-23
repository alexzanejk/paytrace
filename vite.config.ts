import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "dashboard",
  publicDir: "public",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./dashboard/src", import.meta.url)) },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Three pages: the admin dashboard, the small customer pay page (/pay) and the public integration guide (/docs).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        pay: fileURLToPath(new URL("./dashboard/pay.html", import.meta.url)),
        docs: fileURLToPath(new URL("./dashboard/docs.html", import.meta.url)),
      },
    },
  },
});
