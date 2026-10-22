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
    // Two pages: the admin dashboard, and the small customer pay page (served at /pay).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        pay: fileURLToPath(new URL("./dashboard/pay.html", import.meta.url)),
      },
    },
  },
});
