import { INGEST_URL, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { rerunLine as pureRerunLine, rerunSummary, type RerunResult } from "@/lib/rerunWords";

export { RERUN_TEXT, rerunSummary, type RerunResult } from "@/lib/rerunWords";

// "Run the parser again": asks the ingest function (as the signed-in admin) to read a logged SMS that could not be read
// before with the parser as it is now. One log row, or every unread row of the last 30 days.

export interface RerunOutcome {
  ok: boolean;
  message: string;
  results: { id: number; result: RerunResult | string; status?: string | null }[];
}

export async function rerunParser(eventId?: number): Promise<RerunOutcome> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, message: "You are signed out. Sign in again and retry.", results: [] };
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(eventId == null ? { action: "reparse" } : { action: "reparse", event_id: eventId }),
    });
    const b = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; results?: RerunOutcome["results"] };
    if (!res.ok || !b.success) return { ok: false, message: b.message || "The server refused the request.", results: [] };
    return { ok: true, message: rerunSummary(b.results ?? []), results: b.results ?? [] };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your internet and try again.", results: [] };
  }
}

export const rerunLine = (detail: unknown): string | null => pureRerunLine(detail, when);
