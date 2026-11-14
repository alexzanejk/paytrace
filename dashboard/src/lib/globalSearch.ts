// One search box on every page (owner 2026-11-14, step 4 of the dashboard plan): type a TrxID, a phone number or an
// order reference and see everything PayTrace holds about it. This file only reads what was typed and says what to
// look for; no I/O and no imports, so it runs in the node tests.

export type QueryKind = "trx" | "number" | "ref" | "none";

export interface SearchQuery {
  kind: QueryKind;
  /** What to look for, cleaned: upper-case TrxID / reference, or the 11-digit number. Only letters, digits, - and _. */
  text: string;
  /** For a number: every form it is stored in (full first, then the wallets' hidden-middle forms). */
  numberForms: string[];
  /** Why nothing is searched, in words (kind "none"). */
  problem: string;
}

const none = (problem: string): SearchQuery => ({ kind: "none", text: "", numberForms: [], problem });

/** "+880 1712-345678", "8801712345678" or "01712345678" -> "01712345678"; anything else null. */
export function bdNumber(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (/^8801[0-9]{9}$/.test(d)) d = "0" + d.slice(3);
  return /^01[0-9]{9}$/.test(d) ? d : null;
}

/** The ways PayTrace holds a customer's number: in full, or as a wallet prints it with the middle hidden (seen in the
 *  live data: bKash "0171XXXX678"; Nagad SMS "017****5678" and "0171***5678"; Nagad app rows "017XXXX5678"). */
export const numberForms = (n: string): string[] => [
  n,
  `${n.slice(0, 4)}XXXX${n.slice(8)}`,
  `${n.slice(0, 3)}****${n.slice(7)}`,
  `${n.slice(0, 4)}***${n.slice(7)}`,
  `${n.slice(0, 3)}XXXX${n.slice(7)}`,
];

/** Whether a stored number is the searched one in full (a hidden-middle form only MAY be it). */
export const isFullMatch = (stored: string | null | undefined, n: string): boolean => (stored ?? "").replace(/\D/g, "").endsWith(n.slice(1)) && !/[X*]/.test(stored ?? "");

/** Reads what was typed. A number is told from a TrxID by its shape; anything else safe is an order reference. */
export function readQuery(raw: string): SearchQuery {
  const typed = raw.trim();
  if (!typed) return none("Type a TrxID, a phone number or an order number.");
  // A phone number, however it was written (spaces, dashes, +880), but only if it has no letters.
  if (!/[A-Za-z]/.test(typed)) {
    const n = bdNumber(typed);
    if (n) return { kind: "number", text: n, numberForms: numberForms(n), problem: "" };
  }
  const text = typed.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(text)) return none("Use only letters, digits and dashes.");
  if (text.length < 4) return none("Type at least 4 characters.");
  if (text.length > 40) return none("That is too long to be a TrxID or an order number.");
  // Wallet TrxIDs are 8 to 12 letters and digits with no dash (bKash 10, Nagad 8, Rocket 10 digits).
  if (/^[A-Z0-9]{6,24}$/.test(text)) return { kind: "trx", text, numberForms: [], problem: "" };
  return { kind: "ref", text, numberForms: [], problem: "" };
}

/** The address of the results page for what was typed. */
export const searchHash = (raw: string) => `#/search/${encodeURIComponent(raw.trim())}`;

/** What was typed, back out of the address ("" when the address is broken). */
export function queryFromPath(segment: string | undefined): string {
  if (!segment) return "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

/** One line saying what is being looked for. */
export function queryLine(q: SearchQuery): string {
  if (q.kind === "number") return `Phone number ${q.text}`;
  if (q.kind === "trx") return `TrxID or order number ${q.text}`;
  if (q.kind === "ref") return `Order number ${q.text}`;
  return q.problem;
}

/** Whether the wallet app itself can be asked about this (a TrxID of the right length, or a number). */
export const canAskWalletApp = (q: SearchQuery): boolean => q.kind === "number" || (q.kind === "trx" && /^[A-Z0-9]{8,12}$/.test(q.text));
