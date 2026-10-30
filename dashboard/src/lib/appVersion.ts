/** App versions look like "1.0.64": the last number is the build number the phone reports and the build makes. */
export type VersionState = "current" | "behind" | "ahead" | "unknown";

/** The build number inside "1.0.64" (or 64). null when it cannot be read. */
export function buildNumber(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  const m = /^\s*v?(\d+(?:\.\d+)*)\s*$/.exec(v ?? "");
  if (!m) return null;
  const last = Number(m[1].split(".").pop());
  return Number.isFinite(last) ? last : null;
}

/** Where a phone stands against the newest version. A phone that never reported, or a newest version that is not set, is "unknown". */
export function versionState(reported: string | null | undefined, newest: number | null | undefined): VersionState {
  const r = buildNumber(reported);
  if (r === null || !newest || newest < 1) return "unknown";
  return r === newest ? "current" : r < newest ? "behind" : "ahead";
}

/** How many of the given phones are on the newest version. Phones that never reported a version do not count as behind. */
export function versionCounts(versions: Array<string | null | undefined>, newest: number | null | undefined) {
  const out = { current: 0, behind: 0, ahead: 0, unknown: 0 };
  for (const v of versions) out[versionState(v, newest)]++;
  return out;
}
