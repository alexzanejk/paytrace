import { LOADERS, loaderCode } from "../dashboard/src/docs/loaders.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

check("there are six animations to pick from", LOADERS.length === 6);
check("ids are unique", new Set(LOADERS.map((l) => l.id)).size === LOADERS.length);

for (const l of LOADERS) {
  const code = loaderCode(l);
  check(`${l.id}: has a hidden-state rule so the box is invisible until shown`, l.css.includes("#ld[hidden]"));
  check(`${l.id}: the message goes in one element with id ld-text`, (l.markup.match(/id="ld-text"/g) ?? []).length === 1);
  check(`${l.id}: defines showLoading and hideLoading`, /function showLoading\(/.test(l.script) && /function hideLoading\(/.test(l.script));
  check(`${l.id}: every rule starts at #ld (nothing can leak into the site's own styles)`,
    l.css.split("\n").filter((x) => /^[#.@a-z]/.test(x) && !x.startsWith("@") && !x.startsWith("#ld")).length === 0,
    l.css.split("\n").filter((x) => /^[#.a-z]/.test(x) && !x.startsWith("#ld")));
  check(`${l.id}: respects reduced motion`, l.css.includes("prefers-reduced-motion"));
  check(`${l.id}: no external files or inline scripts inside the markup`, !/<script|src=|href=|https?:\/\//.test(l.markup));
  check(`${l.id}: the pasted block is style + div + script, in that order`, code.indexOf("<style>") < code.indexOf('<div id="ld"') && code.indexOf('<div id="ld"') < code.indexOf("<script>"));
  check(`${l.id}: the pasted block is announced to screen readers`, code.includes('role="status"') && code.includes('aria-live="polite"'));
  check(`${l.id}: has a sample message`, (Array.isArray(l.sample) ? l.sample.length : l.sample.length) > 0);
}
const frames = LOADERS.flatMap((l) => [...l.css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]));
check("animation names do not clash between the six", new Set(frames).size === frames.length, frames);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
