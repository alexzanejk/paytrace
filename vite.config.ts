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
      // Read at most 20 files at a time. The icon library alone is over a thousand small files, and Cloudflare's build machine
      // allows few open files at once, so an unlimited read failed there with "EMFILE: too many open files" (and, a run
      // earlier, with a bogus "failed to resolve @supabase/supabase-js"). Reproduced locally with a low `ulimit -n`; with
      // this line the build passes at a limit of 128.
      maxParallelFileOps: 20,
      input: {
        main: fileURLToPath(new URL("./dashboard/index.html", import.meta.url)),
        pay: fileURLToPath(new URL("./dashboard/pay/index.html", import.meta.url)),
        docs: fileURLToPath(new URL("./dashboard/docs/index.html", import.meta.url)),
      },
    },
  },
});
