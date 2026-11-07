// Pure helpers for the Admin Hub door (no I/O), so they can be unit tested.

/** A Hub key: pth_ + 64 hex. Website keys (ptk_) are refused here, and Hub keys are refused everywhere else. */
export const HUB_KEY_PATTERN = /^pth_[0-9a-f]{64}$/;

export function extractHubKey(header: string | null | undefined): string | null {
  const m = (header ?? "").trim().match(/^Bearer\s+(\S+)$/i);
  const k = m?.[1] ?? "";
  return HUB_KEY_PATTERN.test(k) ? k : null;
}

/** Which action the request asks for, from the end of the path. */
export function routeOf(pathname: string, method: string): "held" | "credit" | "ignore" | null {
  const tail = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  if (tail === "held" && (method === "GET" || method === "POST")) return "held";
  if (tail === "credit" && method === "POST") return "credit";
  if (tail === "ignore" && method === "POST") return "ignore";
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Who clicked, as the Hub reports it (an email or a name). Kept short and printable. */
export function actorOf(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
