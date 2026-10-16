// How healthy a phone looks, from when it last spoke and what it reported about itself.
// Dependency-free on purpose, so it can be unit tested on its own.

/** Slower than expected: a heartbeat is due every 15 minutes, and Android sometimes delays them. */
export const LATE_AFTER_MIN = 40;
/** Gone quiet. Keep equal to SILENT_AFTER_MIN in supabase/functions/ingest/index.ts, so this page and the Telegram alert agree. */
export const SILENT_AFTER_MIN = 90;

export type HealthLevel = "online" | "late" | "silent";

export interface DeviceInfo {
  battery?: number;
  monitoring?: boolean;
  sms_permission?: boolean;
  pending?: number;
  failed?: number;
  app_version?: string;
  reported_at?: string;
}

export interface HealthInput {
  last_seen_at: string | null;
  approved_at: string | null;
}

export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  // A browser clock slightly behind the server must not produce "-2 minutes".
  return Math.max(0, (now - t) / 60000);
}

export function deviceHealth(d: HealthInput, now: number = Date.now()) {
  const neverSpoke = !d.last_seen_at;
  // A phone that has not spoken yet is judged from the moment it was approved.
  const minutes = minutesSince(d.last_seen_at ?? d.approved_at, now);
  let level: HealthLevel = "online";
  if (minutes !== null) {
    if (minutes >= SILENT_AFTER_MIN) level = "silent";
    else if (minutes >= LATE_AFTER_MIN) level = "late";
  }
  return { level, minutes, neverSpoke };
}

export function agoText(minutes: number | null): string {
  if (minutes === null) return "never";
  const m = Math.round(minutes);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} d ${h % 24} h ago`;
}

/** Problems a phone reports about itself, in words the owner can act on. Empty when all is well. */
export function infoProblems(info: DeviceInfo | null | undefined): string[] {
  const out: string[] = [];
  if (!info) return out;
  if (info.sms_permission === false) out.push("SMS permission is off, so it cannot see payment messages");
  if (info.monitoring === false) out.push("Monitoring is switched off in the app, so payments are not being forwarded");
  if ((info.failed ?? 0) > 0) out.push(`${info.failed} message${info.failed === 1 ? "" : "s"} could not be sent`);
  return out;
}
