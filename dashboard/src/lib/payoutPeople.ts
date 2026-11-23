// The Payout page ordered BY PERSON (owner 2026-11-23: "filter transaction by user, from most to the same user to less,
// and then none"): who has the most transactions in the period comes first with all of theirs together, down to people with
// one, and transactions with no name last; plus a filter for one person. Pure; the reads live in pages/Payouts.tsx.
// Tested in tests/payoutPeople.test.ts.
import type { PaymentName } from "./payNames";

/** The key of the no-name group / dropdown entry. */
export const NO_NAME = "__none__";
/** With a person chosen or the by-person order on, the page loads the whole period at once (a correct order needs every
 *  row, not the newest 200); past this many rows it says so and asks for a shorter period. */
export const WIDE_LIMIT = 1000;

export interface Person {
  key: string;
  label: string;
  count: number;
}

/** One person = the Telegram id when the name carries one, else the name itself in lower case, so a typed "@Alice" and the
 *  bot's "@alice" are the same person. Nothing for a row without a name. */
export function personKey(n: PaymentName | undefined): string | null {
  if (!n || !n.name) return null;
  if (n.tg_user_id != null) return `u:${n.tg_user_id}`;
  return `n:${n.name.trim().toLowerCase()}`;
}

/** The people of a period, most transactions first (ties by name), from the named rows of the period; `total` = every
 *  transaction of the period, so the last entry is the no-name count (never below zero). */
export function peopleFrom(named: PaymentName[], total: number): Person[] {
  const by = new Map<string, Person>();
  for (const n of named) {
    const key = personKey(n);
    if (!key) continue;
    const p = by.get(key);
    if (p) p.count++;
    else by.set(key, { key, label: n.name!.trim(), count: 1 });
  }
  const people = [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const namedCount = people.reduce((s, p) => s + p.count, 0);
  people.push({ key: NO_NAME, label: "No name", count: Math.max(0, total - namedCount) });
  return people;
}

/** The dropdown's wording: "@alice · 12", "No name · 7". */
export function personOption(p: Person): string {
  return `${p.label} · ${p.count}`;
}

export interface PersonGroup<T> {
  key: string;
  label: string;
  rows: T[];
  total: number;
}

/** The loaded rows in groups: the person with the most rows first (ties by name), rows kept in their given order inside a
 *  group (the page loads newest first), and the no-name rows last. */
export function groupByPerson<T extends { id: string; amount: number | string }>(rows: T[], names: Map<string, PaymentName>): PersonGroup<T>[] {
  const by = new Map<string, PersonGroup<T>>();
  for (const r of rows) {
    const n = names.get(r.id);
    const key = personKey(n) ?? NO_NAME;
    let g = by.get(key);
    if (!g) {
      g = { key, label: key === NO_NAME ? "No name" : n!.name!.trim(), rows: [], total: 0 };
      by.set(key, g);
    }
    g.rows.push(r);
    g.total += Number(r.amount);
  }
  const groups = [...by.values()].filter((g) => g.key !== NO_NAME).sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  const none = by.get(NO_NAME);
  if (none) groups.push(none);
  return groups;
}

/** The rows of one person (or of nobody, for NO_NAME), in their given order. */
export function rowsOfPerson<T extends { id: string }>(rows: T[], names: Map<string, PaymentName>, key: string): T[] {
  return rows.filter((r) => (personKey(names.get(r.id)) ?? NO_NAME) === key);
}

/** The group's header: "@alice · 12 transactions · Tk 6,000". */
export function groupLine(g: PersonGroup<unknown>, money: (n: number) => string): string {
  return `${g.label} · ${g.rows.length} transaction${g.rows.length === 1 ? "" : "s"} · ${money(g.total)}`;
}

/** Said when the period holds more rows than the wide load takes; empty otherwise. */
export function capLine(total: number, limit = WIDE_LIMIT): string {
  if (total <= limit) return "";
  return `Showing the newest ${limit.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}: shorten the period to see everyone.`;
}
