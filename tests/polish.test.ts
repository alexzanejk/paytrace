// Step 5 of the dashboard plan (owner 2026-11-14): one confirm style, one set of colours, short page openings.
// These read the dashboard's own source so the next change cannot quietly bring the old habits back.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const ROOT = join(import.meta.dirname, "..", "dashboard", "src");
// The customer pay page and the public guide have their own looks on purpose (they copy a reference design).
const SKIP = new Set(["pay", "docs"]);
function files(dir: string, top = true): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (top && SKIP.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, false) : /\.tsx?$/.test(name) ? [full] : [];
  });
}
const all = files(ROOT).map((f) => ({ name: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }));
const where = (re: RegExp) => all.filter((f) => re.test(f.text)).map((f) => f.name);

check("the dashboard's files were found", all.length > 80, all.length);

// Confirming: the browser's own box cannot be styled, says "OK / Cancel", and looks like an error.
check("no browser confirm or alert box", where(/window\.(confirm|alert)\(/).length === 0, where(/window\.(confirm|alert)\(/));

// Colours: only the shared status colours, so warn/ok/bad look the same on every page and in dark mode.
const RAW = /(text|bg|border)-(amber|rose|red|green|emerald|yellow|orange)-[0-9]{2,3}/;
check("no raw warning/ok/bad colours", where(RAW).length === 0, where(RAW));

// The money senders share one confirmation.
for (const f of ["components/CashInCommand.tsx", "components/B2bCommand.tsx", "pages/Payouts.tsx", "components/DailyPayouts.tsx"]) {
  check(`${f} confirms with MoneyConfirm`, /<MoneyConfirm\b/.test(all.find((x) => x.name === f)?.text ?? ""));
}

// "Sent or not?" is final either way (a wrong "not sent" pays twice), so both answers ask first.
for (const f of ["pages/Payouts.tsx", "components/DailyPayouts.tsx"]) {
  const t = all.find((x) => x.name === f)?.text ?? "";
  check(`${f}: both unsure answers ask first`, /description=\{SENT_WARNING\}/.test(t) && /description=\{NOT_SENT_WARNING\}/.test(t));
}

// Page openings: one short line; the rest sits behind the "?".
const long: string[] = [];
for (const f of all) {
  for (const m of f.text.matchAll(/<PageHeader\b[\s\S]{0,200}?description=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const text = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, "the last 7 days");
    if (text.length > 95) long.push(`${f.name}: ${text.length}`);
  }
}
check("no page opens with a paragraph", long.length === 0, long);

// One failed page must not blank the dashboard.
const shell = all.find((x) => x.name === "components/AppShell.tsx")?.text ?? "";
const main = all.find((x) => x.name === "main.tsx")?.text ?? "";
check("each page sits inside the safety net", /<ErrorBoundary>\{children\}<\/ErrorBoundary>/.test(shell));
check("the whole app has an outer safety net", /<ErrorBoundary whole>/.test(main));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
