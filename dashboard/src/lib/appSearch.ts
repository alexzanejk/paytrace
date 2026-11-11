/** The owner's own search of a phone's bKash app (owner 2026-11-11: "manually search any transaction id on the bKash agent
 *  app ... transaction page and payout page, phone number too"). The phone logs in, searches the app's Statement and
 *  answers; its first screen is a summary (query, outcome, rows with the full number, the opened row's sheet). Pure. */

export type SearchKind = "trx" | "phone";
export interface SearchQuery { query: string; kind: SearchKind }

/** A TrxID (upper case, letters and digits, 8-12, at least one letter) or an 11-digit number (+880 / 880 folded to 0).
 *  The server and the phone apply the same rule. */
export function searchQuery(raw: string): SearchQuery | null {
  const s = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  const phone = s.startsWith("+880") ? "0" + s.slice(4) : s.startsWith("880") && s.length === 13 ? "0" + s.slice(3) : s;
  if (/^01[0-9]{9}$/.test(phone)) return { query: phone, kind: "phone" };
  if (/^[A-Z0-9]{8,12}$/.test(s) && /[A-Z]/.test(s)) return { query: s, kind: "trx" };
  return null;
}

/** 01322784471 -> 0132XXXX471, the way the bKash app and SMS hide a number. */
export const maskNumber = (n: string): string => (/^01[0-9]{9}$/.test(n) ? n.slice(0, 4) + "XXXX" + n.slice(-3) : n);

export interface SearchResult { query: string; outcome: string; rows: string[]; sheet: string; found: boolean }

/** The phone's summary screen, or null when the answer is not a search answer. */
export function readSearch(screens: string[] | null | undefined): SearchResult | null {
  const first = (screens ?? [])[0];
  if (!first || !first.startsWith("bKash app search")) return null;
  let query = "", outcome = "", sheet = "";
  const rows: string[] = [];
  for (const line of first.split("\n")) {
    if (line.startsWith("query: ")) query = line.slice(7).trim();
    else if (line.startsWith("outcome: ")) outcome = line.slice(9).trim();
    else if (line.startsWith("row: ")) rows.push(line.slice(5).trim());
    else if (line.startsWith("sheet: ")) sheet = line.slice(7).trim();
  }
  return { query, outcome, rows, sheet, found: outcome === "found" && rows.length > 0 };
}

export type Tone = "ok" | "warn" | "idle";

/** The answer in words. "Nothing found" is never called proof: bKash's own search sometimes shows nothing for a real payment. */
export function outcomeWords(r: SearchResult, kind: SearchKind): { tone: Tone; text: string } {
  const o = r.outcome;
  if (r.found) return { tone: "ok", text: kind === "phone" ? `Found ${r.rows.length} transaction(s) with this number in this phone's bKash app.` : "Found in this phone's bKash app." };
  if (o === "nothing found") {
    return kind === "phone"
      ? { tone: "idle", text: "This phone's bKash app shows no transaction with this number." }
      : { tone: "warn", text: "This phone's bKash app shows no transaction with this ID. bKash's search sometimes shows nothing even for a real payment, so this alone does not prove it is fake." };
  }
  if (o === "list did not load" || o === "nothing came up") return { tone: "warn", text: "The bKash app showed no answer (its list did not load). Try again in a minute." };
  if (o.startsWith("a different TrxID")) return { tone: "warn", text: `A row came up, but it opened to ${o.slice(2)}.` };
  if (o.startsWith("a row came up")) return { tone: "warn", text: "A row came up, but its TrxID could not be read. Try again." };
  if (o === "search box not found" || o === "could not type it") return { tone: "warn", text: "The phone could not use the bKash search box. Try again." };
  return { tone: "warn", text: o ? `The search ended: ${o}.` : "The search ended without an answer." };
}

export interface SearchPhone { id: string; name: string; online: boolean }

interface DeviceLike { id: string; name?: string | null; pair_code?: string | null; status: string; last_seen_at?: string | null; info?: unknown }

/** Phones that can search: approved, and their app build says so (heartbeat `app_search`). Online ones first. */
export function searchPhones(devices: DeviceLike[], now = Date.now()): SearchPhone[] {
  return devices
    .filter((d) => d.status === "approved" && (d.info as { app_search?: unknown } | null | undefined)?.app_search === true)
    .map((d) => ({
      id: d.id,
      name: d.name || d.pair_code || "Phone",
      online: !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < 90_000,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online));
}

/** Which phones to ask, in order. "auto": the phone whose SMS carried this TrxID, else every searching phone. */
export function searchTargets(choice: string, phones: SearchPhone[], paymentPhone: string | null): string[] {
  const ids = phones.map((p) => p.id);
  if (choice !== "auto" && choice !== "all") return ids.includes(choice) ? [choice] : [];
  if (choice === "auto" && paymentPhone && ids.includes(paymentPhone)) return [paymentPhone];
  return ids;
}

/** Why the server refused to queue a search, in words. */
export function queueErrorText(message: string): string {
  if (message.includes("app_not_ready")) return "This phone's PayTrace app is too old to search. Update it to the newest version.";
  if (message.includes("balance_off")) return "Balance checks are switched off for this phone (Phones page), and searching follows that switch.";
  if (message.includes("bad_query")) return "Type a TrxID (like DKB6CCN518) or an 11-digit number (01…).";
  if (message.includes("already waiting")) return "A search is already waiting on this phone. Wait for it to finish.";
  if (message.includes("not approved")) return "This phone is not approved.";
  return message;
}
