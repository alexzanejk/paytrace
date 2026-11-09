import { readFileSync } from "node:fs";
import { installWay } from "../dashboard/src/lib/install.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; 22101316I) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

check("already installed wins over everything", installWay(ANDROID, true, true) === "installed");
check("the browser's own install offer is used first", installWay(ANDROID, false, true) === "prompt");
check("iPhone and iPad get the Share > Add to Home Screen steps", installWay(IPHONE, false, false) === "ios" && installWay(IPAD, false, false) === "ios");
check("Android without an offer gets the Chrome menu steps", installWay(ANDROID, false, false) === "android-menu");
check("a computer gets the address-bar hint", installWay(MAC, false, false) === "other");

const manifest = JSON.parse(readFileSync(new URL("../dashboard/public/manifest.webmanifest", import.meta.url), "utf8"));
check("manifest: standalone app with 192 and 512 icons and a maskable one", manifest.display === "standalone" && manifest.start_url === "/"
  && manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192") && manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")
  && manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable"));
const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
const pay = readFileSync(new URL("../dashboard/pay/index.html", import.meta.url), "utf8");
check("the dashboard links the manifest; the white-label pay page never does", html.includes('rel="manifest"') && !pay.includes("manifest") && !pay.includes("PayTrace"));
const sw = readFileSync(new URL("../dashboard/public/sw.js", import.meta.url), "utf8");
check("the service worker keeps nothing and leaves /pay, /docs and other addresses alone",
  !/caches\.(open|match)|cache\.put/.test(sw) && sw.includes('startsWith("/pay")') && sw.includes('startsWith("/docs")') && sw.includes("url.origin !== self.location.origin"));

// The Android dashboard app and the website must vouch for each other, with the permanent key's fingerprint.
const links = JSON.parse(readFileSync(new URL("../dashboard/public/.well-known/assetlinks.json", import.meta.url), "utf8"));
const gradle = readFileSync(new URL("../android/dashboard/build.gradle.kts", import.meta.url), "utf8");
const strings = readFileSync(new URL("../android/dashboard/src/main/res/values/strings.xml", import.meta.url), "utf8");
const amanifest = readFileSync(new URL("../android/dashboard/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const fp: string = links[0].target.sha256_cert_fingerprints[0];
check("assetlinks names the dashboard app's package", links[0].target.package_name === "com.paytrace.dashboard" && gradle.includes('applicationId = "com.paytrace.dashboard"'));
check("assetlinks carries the permanent key (53E2B152 ... DA16B4F)", /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp) && fp.startsWith("53:E2:B1:52") && fp.replace(/:/g, "").endsWith("DA16B4F"));
const site = strings.match(/launch_url[^>]*>(https:\/\/[^/<]+)\//)?.[1];
check("the app opens, vouches for and handles links of one and the same address", !!site && strings.includes(`\\"site\\": \\"${site}\\"`) && amanifest.includes(`android:host="${site!.replace("https://", "")}"`), site);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
