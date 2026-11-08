import { readFileSync } from "node:fs";
import { buildNumber, newestOf, outdatedLine, outdatedPhones, releaseBuild, versionCounts, versionState } from "../dashboard/src/lib/appVersion.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

check("reads the build number from a version name", buildNumber("1.0.64") === 64);
check("accepts a leading v and spaces", buildNumber(" v1.0.7 ") === 7);
check("accepts a plain number", buildNumber(64) === 64 && buildNumber("64") === 64);
check("rejects junk", buildNumber("abc") === null && buildNumber("") === null && buildNumber(null) === null && buildNumber(undefined) === null && buildNumber(-1) === null && buildNumber(1.5) === null);

check("same build is current", versionState("1.0.64", 64) === "current");
check("older build is behind", versionState("1.0.52", 64) === "behind");
check("newer build is ahead", versionState("1.0.70", 64) === "ahead");
check("a phone that never reported is unknown, not behind", versionState(undefined, 64) === "unknown");
check("no newest version set means unknown", versionState("1.0.64", 0) === "unknown" && versionState("1.0.64", null) === "unknown");

const c = versionCounts(["1.0.64", "1.0.55", undefined, "1.0.64", "1.0.99"], 64);
check("counts every state", c.current === 2 && c.behind === 1 && c.unknown === 1 && c.ahead === 1, c);

check("a release tag gives its build", releaseBuild("v1.0.153") === 153 && releaseBuild(null) === null);
check("newest is the highest known, ignoring blanks", newestOf(126, 153) === 153 && newestOf(null, 150) === 150 && newestOf(null, undefined) === null && newestOf(0) === null);
const od = outdatedPhones([{ name: "rubel", version: "1.0.147" }, { name: "Vivo", version: "1.0.150" }, { name: "new", version: undefined }, { name: null, version: "1.0.100" }], 150);
check("outdated phones, most behind first, unreported left out", od.length === 2 && od[0]!.name === "Unnamed phone" && od[0]!.behindBy === 50 && od[1]!.name === "rubel" && od[1]!.version === "1.0.147");
check("nobody is outdated without a newest build", outdatedPhones([{ name: "a", version: "1.0.1" }], null).length === 0);
check("the warning sentence names the phones and the newest", outdatedLine(od, 150).startsWith("Outdated app on 2 phones: Unnamed phone (v1.0.100), rubel (v1.0.147). The newest is v1.0.150.") && outdatedLine([], 150) === "");

const sql = readFileSync(new URL("../supabase/migrations/20261030_040_app_release.sql", import.meta.url), "utf8");
check("only admins can read or change the release", sql.includes("using (public.is_admin())") && sql.includes("if not public.is_admin() then raise exception"));
check("the table has exactly one row", sql.includes("check (id)") && sql.includes("on conflict (id) do nothing"));
check("the version name is built from the number, never typed", sql.includes("version_name = '1.0.' || p_version_code"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
