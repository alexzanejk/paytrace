// Pure wording for "Run the parser again" (no browser imports, so the tests can load it).

export type RerunResult = "stored" | "duplicate" | "ignored" | "still_unreadable" | "sender_rejected" | "failed" | "no_text";

export const RERUN_TEXT: Record<RerunResult, string> = {
  stored: "Stored now",
  duplicate: "Already stored (same TrxID)",
  ignored: "Not a payment message",
  still_unreadable: "Still cannot be read; the parser does not know this layout yet",
  sender_rejected: "Sender is not a provider ID, so it was not stored",
  failed: "Could not be saved; try again",
  no_text: "No message text was kept with this row",
};

export function rerunSummary(results: { result: string }[]): string {
  if (!results.length) return "Nothing to run: every unread message of the last 30 days has been tried already.";
  const n = (k: string) => results.filter((r) => r.result === k).length;
  const parts = [`${results.length} message${results.length === 1 ? "" : "s"} run`];
  if (n("stored")) parts.push(`${n("stored")} stored now`);
  if (n("duplicate")) parts.push(`${n("duplicate")} already stored`);
  if (n("still_unreadable")) parts.push(`${n("still_unreadable")} still unreadable`);
  const other = results.length - n("stored") - n("duplicate") - n("still_unreadable");
  if (other) parts.push(`${other} other`);
  return parts.join(", ") + ".";
}

/** What the last re-run of a log row came to, from the row's detail. Null when it was never re-run. */
export function rerunLine(detail: unknown, fmtWhen: (iso: string) => string = (s) => s): string | null {
  const d = (detail ?? {}) as { rerun_result?: unknown; rerun_at?: unknown; rerun_status?: unknown };
  if (typeof d.rerun_result !== "string") return null;
  const text = RERUN_TEXT[d.rerun_result as RerunResult] ?? d.rerun_result;
  const at = typeof d.rerun_at === "string" ? fmtWhen(d.rerun_at) : "";
  const status = typeof d.rerun_status === "string" && d.rerun_result === "stored" ? ` (status: ${d.rerun_status.replace(/_/g, " ")})` : "";
  return `Run again${at ? " " + at : ""}: ${text}${status}`;
}
