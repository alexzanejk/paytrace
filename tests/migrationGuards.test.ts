// Guards against a function being re-created from an OLD copy and losing a line a later migration added.
// 2026-11-22: migration 124 rebuilt tg_claim_judge2 from 113's body instead of 114's and lost the one line that
// writes the bot's @username onto a matched transaction; 109 posts showed "Set name" for a day. Rule: re-create a
// function from its NEWEST definition. These checks read the newest migration that defines each guarded function.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`, extra ?? ""); }
}

const dir = join(import.meta.dirname ?? ".", "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** The body of `fn` in the NEWEST migration that defines it (from its create line to the closing `end $$;`). */
export function newestBody(fn: string, read: (file: string) => string = (f) => readFileSync(join(dir, f), "utf8")): { file: string; body: string } | null {
  const head = `create or replace function public.${fn}(`;
  for (const f of [...files].reverse()) {
    const text = read(f);
    const at = text.lastIndexOf(head);
    if (at < 0) continue;
    const end = text.indexOf("end $$;", at);
    return { file: f, body: text.slice(at, end < 0 ? undefined : end + 7) };
  }
  return null;
}

// What each guarded function must still contain, and why.
const MUST_KEEP: Record<string, { line: string; why: string }[]> = {
  tg_claim_judge2: [
    { line: "perform public.payment_name_from_claim(c.id);", why: "the bot's @username on a matched transaction (114)" },
    { line: "update public.payment_names n set name = public.tg_person_name(c.tg_user_id)", why: "a changed name follows on the person's transactions (114)" },
    { line: "react_kind = coalesce(v_kind, react_kind)", why: "👍 / 👎 by state (124)" },
    { line: "nf_unsend_pending = case when nf_message_id is not null then true else nf_unsend_pending end", why: "the 'payment not received' reply is taken back once the post means a transaction (127)" },
    { line: "react_pending = (nf_trx is not null and react_kind = 'down' and reacted_at is null)", why: "a pending 👎 of that reply survives a re-judge that still finds nothing (127)" },
  ],
  resolve_payout: [
    { line: "v_checking", why: "the owner may decide while the wallet check runs (125)" },
    { line: "o.method = 'manual' and not p_sent", why: "undo of a by-hand payout (065)" },
  ],
  resolve_commission_pay: [
    { line: "v_checking", why: "the owner may decide while the wallet check runs (125)" },
    { line: "update public.commission_payouts set voided_at = now()", why: "undo of a by-hand commission payment voids its record (068)" },
  ],
};

for (const [fn, keeps] of Object.entries(MUST_KEEP)) {
  const found = newestBody(fn);
  check(`${fn} is defined in some migration`, found !== null);
  if (!found) continue;
  for (const k of keeps) check(`${fn} (${found.file}) still has: ${k.why}`, found.body.includes(k.line), `missing: ${k.line}`);
}

// The guard itself notices a loss: 124's copy of tg_claim_judge2 lacks the name line.
const old124 = newestBody("tg_claim_judge2", (f) => (f.startsWith("20261121_124") ? readFileSync(join(dir, f), "utf8") : ""));
check("the guard would have caught 124 (its tg_claim_judge2 has no name line)", old124 !== null && !old124.body.includes("payment_name_from_claim(c.id)"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
