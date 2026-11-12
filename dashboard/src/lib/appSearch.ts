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
  if (!first || !/^(bKash|Nagad) app search/.test(first)) return null;
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

/** 01883718710 -> 018****8710, the way Nagad's SMS and app hide a number. */
export const nagadMask = (n: string): string => (/^01[0-9]{9}$/.test(n) ? `${n.slice(0, 3)}****${n.slice(-4)}` : n);

/** Which wallet app a search looks in (owner 2026-11-11: the Nagad agent app as well as bKash's, migration 093). */
export type SearchApp = "bkash" | "nagad";
export const SEARCH_APP_LABEL: Record<SearchApp, string> = { bkash: "bKash app", nagad: "Nagad app" };
/** The heartbeat flag that says a phone's build can search that app. */
const SEARCH_FLAG: Record<SearchApp, string> = { bkash: "app_search", nagad: "app_nagad" };
/** The server's queue function for that app. */
export const SEARCH_RPC: Record<SearchApp, string> = { bkash: "queue_app_search", nagad: "queue_nagad_search" };

/** Every approved phone, each marked whether its app build can search that wallet app (heartbeat `app_search`, or
 *  `app_nagad` for the Nagad app). Online ones first. The owner may pick any of them; one that cannot search is shown
 *  but cannot be chosen (owner 2026-11-12: "let me select any phone I want"). */
export function phoneChoices(devices: DeviceLike[], now = Date.now(), app: SearchApp = "bkash"): (SearchPhone & { canSearch: boolean })[] {
  return devices
    .filter((d) => d.status === "approved")
    .map((d) => ({
      id: d.id,
      name: d.name || d.pair_code || "Phone",
      online: !!d.last_seen_at && now - new Date(d.last_seen_at).getTime() < 90_000,
      canSearch: (d.info as Record<string, unknown> | null | undefined)?.[SEARCH_FLAG[app]] === true,
    }))
    .sort((a, b) => Number(b.canSearch) - Number(a.canSearch) || Number(b.online) - Number(a.online));
}

/** Phones that can search that wallet app, online ones first. */
export function searchPhones(devices: DeviceLike[], now = Date.now(), app: SearchApp = "bkash"): SearchPhone[] {
  return phoneChoices(devices, now, app).filter((p) => p.canSearch).map(({ canSearch: _c, ...p }) => p);
}

/** Where PayTrace saw this TrxID or number: an SMS (payments) or a customer typing it on a deposit order. */
export interface Seen { device_id: string | null; provider: string | null }
export type BestWhy = "sms" | "order" | "none";
export interface Best { deviceId: string | null; app: SearchApp | null; why: BestWhy }

const walletApp = (p: string | null): SearchApp | null => (p === "bkash" || p === "nagad" ? p : null);

/** The right phone and wallet app for a search (owner 2026-11-12: "on best phone it chooses the wrong phone sometimes
 *  instead of the phone where the message arrived"). First the phone the SMS arrived on, with ITS wallet (a Nagad TrxID
 *  is never in the bKash app, which is how a Nagad ID was once searched in three bKash apps); else the phone whose number
 *  the customer was shown on the order where they typed it; else nobody is known. */
export function bestPhone(sms: Seen[], orders: Seen[]): Best {
  for (const list of [sms, orders] as const) {
    const hit = list.find((r) => r.device_id && walletApp(r.provider));
    if (hit) return { deviceId: hit.device_id, app: walletApp(hit.provider), why: list === sms ? "sms" : "order" };
  }
  const anyApp = [...sms, ...orders].map((r) => walletApp(r.provider)).find(Boolean) ?? null;
  return { deviceId: null, app: anyApp, why: "none" };
}

export interface Plan { targets: string[]; note: string; problem: string }

/** Which phones to ask, in order, with a line saying why. "auto" asks ONLY the best phone; it never quietly asks other
 *  phones instead when the best one cannot search (that is how the wrong phones were asked). "all" asks every phone that
 *  can search; a chosen phone is asked alone. */
export function planSearch(choice: string, phones: SearchPhone[], best: Best, nameOf: (id: string) => string): Plan {
  const ids = phones.map((p) => p.id);
  if (choice === "all") return { targets: ids, note: ids.length ? "Asking every phone that can search, one after another." : "", problem: ids.length ? "" : "No phone can search yet: each needs the newest PayTrace app." };
  if (choice !== "auto") {
    return ids.includes(choice)
      ? { targets: [choice], note: `Asking ${nameOf(choice)}, as you chose.`, problem: "" }
      : { targets: [], note: "", problem: `${nameOf(choice)} cannot search this app yet: update its PayTrace app, or choose another phone.` };
  }
  if (best.deviceId) {
    const why = best.why === "sms" ? "the SMS arrived there" : "the customer was shown its number on the order";
    return ids.includes(best.deviceId)
      ? { targets: [best.deviceId], note: `Asking ${nameOf(best.deviceId)}: ${why}.`, problem: "" }
      : { targets: [], note: "", problem: `The right phone is ${nameOf(best.deviceId)} (${why}), but it cannot search yet: update its PayTrace app, or choose a phone in the list.` };
  }
  return { targets: ids, note: ids.length ? "PayTrace has never seen this, so every phone that can search is asked, one after another." : "", problem: ids.length ? "" : "No phone can search yet: each needs the newest PayTrace app." };
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
