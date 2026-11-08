// The newest app build on the download link: the GitHub release the Android build publishes on every build of main
// (tag v1.0.<build>, asset paytrace.apk). Read straight from GitHub's public API, at most once every 10 minutes per
// browser (60 unsigned calls an hour are allowed per address, and the Phones page refreshes every 10 seconds).
// Nothing here can fail the page: any problem answers null and the typed build number is used instead.
import { releaseBuild } from "@/lib/appVersion";

export const RELEASE_API = "https://api.github.com/repos/alexzanejk/paytrace/releases/latest";
const CACHE_KEY = "pt-latest-release";
const CACHE_MS = 10 * 60_000;

export async function latestReleaseBuild(now: number = Date.now()): Promise<number | null> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { at?: number; build?: number | null };
      if (typeof c.at === "number" && now - c.at < CACHE_MS) return c.build ?? null;
    }
  } catch {
    // no storage: ask every time
  }
  let build: number | null = null;
  try {
    const res = await fetch(RELEASE_API, { headers: { accept: "application/vnd.github+json" } });
    if (res.ok) {
      const j = (await res.json()) as { tag_name?: string };
      build = releaseBuild(j.tag_name);
    }
  } catch {
    build = null;
  }
  try {
    // A failed lookup is cached too, so a rate limit does not turn into a call every 10 seconds.
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, build }));
  } catch {
    // ignore
  }
  return build;
}
