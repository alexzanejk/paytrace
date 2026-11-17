// Puts the self-hosted pay page's script and styles INTO its HTML (vite.selfpay.config.ts builds them as separate files),
// so a website gets one file that needs nothing else. Writes dist/selfpay/pay-page.html. Run after both Vite builds.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const built = "dist-selfpay";
let html = readFileSync(join(built, "selfpay", "index.html"), "utf8");

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const css = readFileSync(join(built, href.replace(/^\//, "")), "utf8");
  return `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
});
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_m, src) => {
  const js = readFileSync(join(built, src.replace(/^\//, "")), "utf8");
  return `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`;
});

if (/(src|href)="\/assets\//.test(html)) throw new Error("self-hosted pay page still points at a separate file");
if (html.split("__PAY_CONFIG__").length !== 2) throw new Error("the __PAY_CONFIG__ placeholder must appear exactly once");

const out = join("dist", "selfpay", "pay-page.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`self-hosted pay page: ${out} (${Math.round(html.length / 1024)} KB)`);
