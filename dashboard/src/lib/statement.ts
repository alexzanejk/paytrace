/** Reading the wallet's own statement screens, which the phone sends back word for word.
 *
 *  The reading lives HERE, not on the phone, so a wording change never needs a new app on every phone — the same
 *  reason SMS is parsed on the server. Pure functions, tested in tests/statement.test.ts.
 *
 *  The owner's real bKash agent menu (2026-11-02). The list, four entries to a page:
 *
 *      Statement List:
 *      1 02/11/26 Cash In -Tk -200.00
 *      2 29/10/26 Cash Out -Tk 500.00
 *      # NEXT
 *
 *  and one entry, opened by typing its number:
 *
 *      Cash In Tk -200.00
 *      Fee Tk 0.00
 *      From 01706630756
 *      To 01846632612
 *      TrxID DK29URXBHB
 *      At 02/11/2026 06:24:45
 *
 *  The sign in the list is the wallet's own: money that LEFT the wallet is negative (a Cash In the agent paid out, a
 *  B2B transfer sent), money that came IN is positive (a customer's Cash Out). Everything is kept exactly as written
 *  and nothing is guessed: a line that cannot be read is returned as-is so the owner can still see it.
 */

export interface StatementRow {
  /** The number the wallet gave it, which is how a single entry is asked for. */
  no: number;
  /** As the wallet wrote it, "02/11/26". */
  date: string;
  /** "Cash In", "Cash Out", "B2B Transfer", or whatever else the wallet says. */
  type: string;
  /** Signed, the wallet's own way round: negative means it left the wallet. */
  amount: number;
  /** The whole line, in case the reading above missed something. */
  raw: string;
}

export interface StatementDetail {
  type: string | null;
  amount: number | null;
  fee: number | null;
  from: string | null;
  to: string | null;
  trxId: string | null;
  at: string | null;
  raw: string;
}

const money = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** One line of the list: "1 02/11/26 Cash In -Tk -200.00". The "-Tk" is the wallet's separator, not a minus. */
export function readRow(line: string): StatementRow | null {
  const m = line.trim().match(
    /^(\d{1,2})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s*-?\s*Tk\.?\s*(-?[\d,]+(?:\.\d{1,2})?)\s*$/i,
  );
  if (!m) return null;
  const amount = money(m[4]);
  if (amount === null) return null;
  return { no: Number(m[1]), date: m[2], type: m[3].trim(), amount, raw: line.trim() };
}

/** Every entry on every page the phone brought back, in the order the wallet listed them. */
export function readList(screens: string[] | null | undefined): StatementRow[] {
  const rows: StatementRow[] = [];
  const seen = new Set<number>();
  for (const screen of screens ?? []) {
    for (const line of String(screen).split("\n")) {
      const row = readRow(line);
      if (row && !seen.has(row.no)) {
        seen.add(row.no);
        rows.push(row);
      }
    }
  }
  return rows.sort((a, b) => a.no - b.no);
}

/** Lines of a list page the reading could not make sense of, so nothing is ever silently dropped. */
export function unreadLines(screens: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const screen of screens ?? []) {
    for (const line of String(screen).split("\n")) {
      const t = line.trim();
      if (!t || readRow(t)) continue;
      if (/^statement list:?$/i.test(t) || /^#\s*NEXT$/i.test(t) || /^0*\s*BACK$/i.test(t)) continue;
      out.push(t);
    }
  }
  return out;
}

const field = (text: string, name: string): string | null => {
  // The word boundary matters: without it "To" would also match the start of "Total".
  const m = text.match(new RegExp(`^\\s*${name}\\b\\s*:?\\s*(.+?)\\s*$`, "im"));
  return m ? m[1] : null;
};

/** The screen of one entry. Everything is optional: a wallet PayTrace has not seen keeps its raw text. */
export function readDetail(screen: string | null | undefined): StatementDetail | null {
  const text = String(screen ?? "").trim();
  if (!text) return null;
  const head = text.match(/^(.+?)\s*-?\s*Tk\.?\s*(-?[\d,]+(?:\.\d{1,2})?)\s*$/im);
  const feeText = field(text, "Fee");
  return {
    type: head ? head[1].trim() : null,
    amount: head ? money(head[2]) : null,
    fee: feeText ? money(feeText.replace(/Tk\.?/i, "").trim()) : null,
    from: field(text, "From"),
    to: field(text, "To"),
    trxId: text.match(/TrxID\s*:?\s*([A-Za-z0-9]{4,24})/i)?.[1] ?? null,
    at: field(text, "At"),
    raw: text,
  };
}

/** Is this a statement LIST (pages of numbered entries) or ONE entry? */
export const looksLikeAList = (screens: string[] | null | undefined): boolean => readList(screens).length > 0;

export type RowMatch = "have" | "missing" | "unknown";

/** Does PayTrace hold a payment that is plainly this statement line?
 *
 *  The list gives only a day, a kind and an amount: no TrxID, no time. So the test is deliberately loose — the same
 *  day, the same amount to the paisa — and anything the wallet calls something PayTrace does not store as money
 *  (a B2B transfer out, a Cash In the agent paid) is "unknown" rather than "missing", because no SMS was ever
 *  expected for it. Only a Cash Out, which always sends an SMS, can be MISSING.
 */
export function matchRow(
  row: StatementRow,
  payments: { trx_id: string; amount: number; occurred_at: string | null; created_at: string }[],
  dayOf: (iso: string) => string,
): RowMatch {
  const kind = row.type.replace(/\s+/g, " ").trim().toLowerCase();
  if (kind !== "cash out") return "unknown";
  const day = statementDay(row.date);
  if (!day) return "unknown";
  const hit = payments.some((p) => {
    const when = p.occurred_at ?? p.created_at;
    return Math.abs(Number(p.amount) - Math.abs(row.amount)) < 0.005 && dayOf(when) === day;
  });
  return hit ? "have" : "missing";
}

/** The wallet writes "02/11/26", day first, two-digit year. Returned as "2026-11-02" so days can be compared. */
export function statementDay(date: string): string | null {
  const m = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** What the owner is told about a whole statement, in one line. */
export function statementSummary(rows: StatementRow[], matches: RowMatch[]): string {
  if (rows.length === 0) return "The wallet showed no transactions.";
  const missing = matches.filter((m) => m === "missing").length;
  const have = matches.filter((m) => m === "have").length;
  if (missing === 0) return `${rows.length} transactions. PayTrace has every Cash Out the wallet lists.`;
  return `${rows.length} transactions. ${missing} Cash Out ${missing === 1 ? "is" : "are"} MISSING from PayTrace` +
    `${have > 0 ? `, ${have} ${have === 1 ? "is" : "are"} there` : ""}.`;
}
