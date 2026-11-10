import { b2bLine, b2bNotes, b2bSummary, cashTick, normalizeDso, parseB2bAmount, B2B_KIND, MOST_B2B } from "../dashboard/src/lib/b2b.ts";

let failed = 0;
const check = (name: string, ok: boolean, got?: unknown) => {
  if (!ok) { failed++; console.error("FAIL", name, got ?? ""); } else console.log("ok  ", name);
};
const money = (n: number) => `Tk ${n.toLocaleString("en-US")}`;
const when = (t: string) => t;
const other = (code: string | null) => `other:${code}`;
const base = { id: "c", kind: B2B_KIND, provider: "bkash", balance: null, error: null, created_at: "t0", finished_at: "t1", amount: 5000, to_number: "01324245010" };

check("kind is letters only (the server's rule)", /^[a-z_]+$/.test(B2B_KIND));
check("amounts: commas, Bangla digits, paisa", parseB2bAmount("25,000") === 25000 && parseB2bAmount("২৫০০০") === 25000 && parseB2bAmount("5000.50") === 5000.5);
check("amounts: limits", parseB2bAmount("99") === null && parseB2bAmount("250000") === MOST_B2B && parseB2bAmount("250000.01") === null);
check("amounts: junk", parseB2bAmount("5,000.123") === null && parseB2bAmount("abc") === null && parseB2bAmount("") === null);
check("DSO numbers fold +880", normalizeDso("+880 1324-245010") === "01324245010" && normalizeDso("01324245010") === "01324245010");
check("DSO numbers must be whole", normalizeDso("0132424501") === null && normalizeDso("0232424501x") === null);
check("summary names amount and DSO", b2bSummary(5000, "01324245010", money).includes("Tk 5,000") && b2bSummary(5000, "01324245010", money).includes("01324245010"));
check("the cash tick names the amount", cashTick(5000, money).includes("Tk 5,000") && cashTick(5000, money).includes("yes"));
check("done line has receipt and balance",
  b2bLine({ ...base, status: "done", trx_id: "DKA1AWJZ9L", balance: 4441.03 }, money, when, other).includes("DKA1AWJZ9L"));
check("a DSO mismatch says nothing was sent",
  b2bLine({ ...base, status: "failed", error: "dso_does_not_match" }, money, when, other).includes("NOTHING was sent"));
check("an unknown error falls back to the shared wording",
  b2bLine({ ...base, status: "failed", error: "phone_locked" }, money, when, other).includes("other:phone_locked"));
check("after the hold it says check before sending again",
  b2bLine({ ...base, status: "failed", error: "no_answer_after_hold" }, money, when, other).includes("before sending again"));
check("notes are picked from the phone's summary",
  b2bNotes({ screens: ["bKash app B2B\nto DSO: 01324245010\nbKash asked whether the DSO paid the cash: answered yes\n\nWhat the phone saw:\n..."] }).length === 1);
check("no screens, no notes", b2bNotes(null).length === 0);

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("\nall passed");
