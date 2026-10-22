// The dashboard (a web page on another address) calls this function for the admin-only actions test_alert and test_wake.
// Browsers only allow that when the server says so, and they ask first with an OPTIONS request. The phones are not
// browsers and need none of this. Only the dashboard's own address is allowed, never "any site": the admin's login
// token is sent in a header, so another website must not be able to use it.

export function corsHeaders(origin: string | null, allowedOrigin: string): Record<string, string> {
  if (!origin || origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
