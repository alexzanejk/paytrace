// One Telegram person's timeline (step 5 of the Telegram plan, owner 2026-11-20): what `tg_person_history` returns,
// in plain words, newest first, and as a CSV. Pure, tested in tests/tgHistory.test.ts.

export interface HistoryEvent {
  at: string | null;
  kind: string;            // post | plan_queued | plan_<status> | payout | reply
  status?: string | null;
  trx?: string | null;
  amount?: number | string | null;
  provider?: string | null;
  detail?: string | null;
  message_id?: number | null;
  photo?: boolean | null;
  reacted?: boolean | null;
  react_kind?: string | null; // up | down (migration 124)
  warned?: boolean | null;    // the bot replied under a conflicting post asking to delete it
  reply?: string | null;
  where?: string | null;    // reply: private | group (migration 119)
  count?: number | null;
  to?: string | null;
  method?: string | null;
  id?: string | null;
}

const tk = (n: number | string | null | undefined) => n == null ? "" : "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WALLET: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const POST: Record<string, string> = {
  new: "posted (not read yet)", unmatched: "posted, no match", matched: "posted, matched", paid: "posted, already paid out",
  held: "posted, transaction held", duplicate: "posted the same TrxID again", conflict: "posted a TrxID another person submitted first",
  review: "posted, needs a look", ignored: "posted, ignored by you",
};
const PLAN: Record<string, string> = {
  plan_queued: "payout queued", plan_sending: "payout started on the phone", plan_paid: "payout paid", plan_unsure: "payout unsure (sent or not?)",
  plan_failed: "payout failed, nothing sent", plan_cancelled: "payout taken back",
};

/** One line per event, in words. The TrxID, amount and the person's own words are data, never trusted markup. */
export function historyLine(e: HistoryEvent): { title: string; detail: string; tone: "ok" | "warn" | "bad" | "idle" } {
  const amount = e.amount == null ? "" : tk(e.amount);
  if (e.kind === "post") {
    const what = POST[e.status ?? ""] ?? `posted (${e.status})`;
    const who = e.photo ? "a photo" : "a text";
    const tx = e.trx ? `${WALLET[e.provider ?? ""] ?? e.provider ?? ""} ${e.trx}${amount ? " · " + amount : ""}`.trim() : "";
    const marks = [e.reacted ? (e.react_kind === "down" ? "👎 sent" : "👍 sent") : "", e.warned ? "warned to delete the post" : "", e.reply ? `replied (${e.reply})` : ""].filter(Boolean).join(" · ");
    return {
      title: `${what}: ${who}${tx ? " · " + tx : ""}`,
      detail: [e.detail ?? "", marks].filter(Boolean).join(" · "),
      tone: e.status === "matched" || e.status === "paid" ? "ok" : e.status === "conflict" || e.status === "held" || e.status === "review" ? "warn" : "idle",
    };
  }
  if (e.kind.startsWith("plan_")) {
    const what = PLAN[e.kind] ?? e.kind.replace("plan_", "payout ");
    return {
      title: `${what}: ${e.count ?? "?"} transaction${e.count === 1 ? "" : "s"}${amount ? ", " + amount : ""}${e.to ? " to " + e.to : ""}`,
      detail: e.detail ?? "",
      tone: e.kind === "plan_paid" ? "ok" : e.kind === "plan_failed" || e.kind === "plan_unsure" ? "bad" : "idle",
    };
  }
  if (e.kind === "payout") {
    const how = e.method === "manual" ? "marked paid by hand" : e.method === "send_money" ? "by Send Money" : e.method === "cash_in" ? "by Cash In" : e.method ?? "";
    const st = e.status === "paid" ? "Paid" : e.status === "sending" ? "Sending" : e.status === "unsure" ? "Unsure" : e.status === "failed" ? "Failed" : e.status ?? "";
    return {
      title: `${st} ${amount}${e.to ? " to " + e.to : ""}${how ? " (" + how + ")" : ""}${e.trx ? " · TrxID " + e.trx : ""}`.trim(),
      detail: [e.count ? `${e.count} transaction${e.count === 1 ? "" : "s"}` : "", e.detail ?? ""].filter(Boolean).join(" · "),
      tone: e.status === "paid" ? "ok" : e.status === "unsure" || e.status === "failed" ? "bad" : "idle",
    };
  }
  if (e.kind === "reply") {
    const st = e.status === "sent" ? (e.where === "private" ? "Notice sent privately (their inbox)" : "Notice sent in the group") : e.status === "failed" ? "Notice not sent" : "Notice waiting to be sent";
    return { title: st, detail: e.detail ?? "", tone: e.status === "failed" ? "bad" : e.status === "sent" ? "ok" : "idle" };
  }
  return { title: e.kind, detail: e.detail ?? "", tone: "idle" };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The timeline as CSV text (formula-safe cells). */
export function historyCsv(events: HistoryEvent[]): string {
  const head = ["when", "what", "detail", "status", "trx_id", "amount", "to", "count"];
  const rows = events.map((e) => {
    const l = historyLine(e);
    return [e.at ?? "", l.title, l.detail, e.status ?? "", e.trx ?? "", e.amount == null ? "" : String(e.amount), e.to ?? "", e.count == null ? "" : String(e.count)].map(csvCell).join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

/** A short summary for the top of the panel. */
export function historySummary(events: HistoryEvent[]): string {
  const posts = events.filter((e) => e.kind === "post").length;
  const matched = events.filter((e) => e.kind === "post" && (e.status === "matched" || e.status === "paid")).length;
  const paid = events.filter((e) => e.kind === "payout" && e.status === "paid");
  const sum = paid.reduce((a, e) => a + Number(e.amount ?? 0), 0);
  return `${posts} post${posts === 1 ? "" : "s"}, ${matched} matched · ${paid.length} payout${paid.length === 1 ? "" : "s"} paid${paid.length ? " (" + tk(sum) + ")" : ""}`;
}
