// Same rule as ingest/cors.ts: only the dashboard's own address may call the admin actions from a browser.
export function corsHeaders(origin: string | null, allowed: string | string[]): Record<string, string> {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!origin || !list.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
