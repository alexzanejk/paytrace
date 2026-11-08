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

/** The build number of a GitHub release tag such as "v1.0.153" (the Android build publishes one per build on main). */
export const releaseBuild = (tag: string | null | undefined): number | null => buildNumber(tag);

/** The newest build PayTrace knows of: the one the owner typed, or the newest release on the download link, whichever is higher. */
export function newestOf(...candidates: Array<number | null | undefined>): number | null {
  const n = candidates.filter((c): c is number => typeof c === "number" && Number.isInteger(c) && c > 0);
  return n.length ? Math.max(...n) : null;
}

export interface Outdated { name: string; version: string; behindBy: number }

/** The phones running an older app than the newest build, most behind first. A phone that never reported is not listed. */
export function outdatedPhones(phones: Array<{ name: string | null; version: string | null | undefined }>, newest: number | null | undefined): Outdated[] {
  if (!newest) return [];
  const out: Outdated[] = [];
  for (const p of phones) {
    const b = buildNumber(p.version);
    if (b !== null && b < newest) out.push({ name: p.name || "Unnamed phone", version: `1.0.${b}`, behindBy: newest - b });
  }
  return out.sort((a, b) => b.behindBy - a.behindBy);
}

/** One sentence for the Phones page's warning card. */
export function outdatedLine(list: Outdated[], newest: number): string {
  if (list.length === 0) return "";
  const names = list.map((o) => `${o.name} (v${o.version})`).join(", ");
  return `Outdated app on ${list.length} phone${list.length === 1 ? "" : "s"}: ${names}. The newest is v1.0.${newest}. Update from the app's Settings, or install the download link.`;
}
