import { normalizeNumber, expectedBefore, CASHIN_LABEL, CASHIN_TONE, cashinSettleable, cashinCancellable, type CashinStatus } from "../dashboard/src/lib/cashin.ts";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

check("plain number", normalizeNumber("01712345678") === "01712345678");
check("spaces and dashes", normalizeNumber("017 1234-5678") === "01712345678");
check("+880 prefix", normalizeNumber("+8801712345678") === "01712345678");
check("Bangla digits", normalizeNumber("০১৭১২৩৪৫৬৭৮") === "01712345678");
check("too short", normalizeNumber("0171234567") === null);
check("not starting 01", normalizeNumber("02712345678") === null);
check("letters", normalizeNumber("hello") === null);

// bKash: cash-in of Tk 100 gives 0.38 incentive that is added to the balance
check("expected balance with incentive", expectedBefore(9000, 100, 0.38) === 8900.38);
check("rounded to paisa", expectedBefore(10000, 4000, 15.2) === 6015.2);

const all: CashinStatus[] = ["open", "checking", "mismatch", "review", "verified", "rejected", "cancelled"];
check("every status has a label and tone", all.every((s) => !!CASHIN_LABEL[s] && !!CASHIN_TONE[s]));
check("settle only submitted ones", cashinSettleable("checking") && cashinSettleable("review") && !cashinSettleable("open") && !cashinSettleable("verified"));
check("cancel only unstarted", cashinCancellable("open") && !cashinCancellable("checking"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
