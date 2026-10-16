// Runs every tests/*.test.ts with Node's built-in TypeScript stripping. Stops at the first failing file.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.ts")).sort();
let failed = false;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join("tests", f)], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { failed = true; console.error(`\n${f} FAILED`); }
}
console.log(failed ? "\nSOME TESTS FAILED" : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
