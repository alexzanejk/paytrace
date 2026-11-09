// PayTrace dashboard service worker (2026-11-09). Small on purpose: it makes the dashboard installable as an app on phones
// and computers, and shows a plain "no internet" page instead of the browser's error when the app is opened offline.
// It caches NOTHING: every page and every figure is always fetched live, so the app can never show old money data, and
// a new dashboard published on Cloudflare is what the next open shows. It never touches the customer pay page (/pay),
// the guide (/docs) or any other address (Supabase): those requests go straight to the network as if it did not exist.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PayTrace</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#eef2f7;color:#0f172a;display:grid;place-items:center;min-height:100vh">
<main style="max-width:22rem;padding:1.5rem;text-align:center"><div style="width:56px;height:56px;margin:0 auto 1rem;border-radius:16px;background:#1565e8"></div>
<h1 style="font-size:1.25rem;margin:0 0 .5rem">No internet</h1>
<p style="margin:0 0 1.25rem;color:#475569">PayTrace needs the internet to show live payments. Check Wi-Fi or mobile data, then try again.</p>
<a href="/" style="display:inline-block;padding:.6rem 1.2rem;border-radius:999px;background:#1565e8;color:#fff;text-decoration:none">Try again</a></main></body></html>`;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/pay") || url.pathname.startsWith("/docs") || url.pathname.startsWith("/.well-known")) return;
  event.respondWith(
    fetch(req).catch(() => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })),
  );
});
