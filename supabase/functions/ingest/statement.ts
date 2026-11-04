// Reads the wallet's statement LIST the phone sent back, for the automatic check of a held payment (migration 053).
// A copy of the list part of dashboard/src/lib/statement.ts: the two deploy separately, and tests/walletConfirm.test.ts
// fails if they ever read a sample differently. Pure, no I/O.
//
// The owner's real bKash agent list: "1 02/11/26 Cash In -Tk -200.00" / "2 29/10/26 Cash Out -Tk 500.00". The "-Tk" is
// the wallet's separator; the sign AFTER it is the wallet's own: negative = money left the wallet, positive = money came in.

export interface StatementLine {
  /** "2026-11-02" (the wallet writes 02/11/26, day first). */
  day: string;
  /** Always positive. */
  amount: number;
  /** true = money came INTO the wallet (a customer's Cash Out). */
  in: boolean;
  type: string;
}

const money = (s: string): number | null => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function dayOf(date: string): string | null {
  const m = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function readLine(line: string): (StatementLine & { no: number }) | null {
  const m = line.trim().match(/^(\d{1,2})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s*-?\s*Tk\.?\s*(-?[\d,]+(?:\.\d{1,2})?)\s*$/i);
  if (!m) return null;
  const signed = money(m[4]);
  const day = dayOf(m[2]);
  if (signed === null || !day) return null;
  return { no: Number(m[1]), day, amount: Math.abs(signed), in: signed >= 0, type: m[3].trim() };
}

/** Every entry on every page, each number once. An unreadable line is simply left out (the judge then says how many it read). */
export function readStatementLines(screens: unknown): StatementLine[] {
  const out: StatementLine[] = [];
  const seen = new Set<number>();
  for (const screen of Array.isArray(screens) ? screens : []) {
    for (const line of String(screen).split("\n")) {
      const row = readLine(line);
      if (row && !seen.has(row.no)) {
        seen.add(row.no);
        out.push({ day: row.day, amount: row.amount, in: row.in, type: row.type });
      }
    }
  }
  return out;
}
