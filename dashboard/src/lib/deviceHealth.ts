// How healthy a phone looks, from when it last spoke and what it reported about itself.
// Dependency-free on purpose, so it can be unit tested on its own.

/** The phone sends a heartbeat every 30 seconds. After 90 seconds of silence (three missed) it is shown as Offline. */
export const OFFLINE_AFTER_SEC = 90;
/** Telegram tells the owner after this long offline, so a brief network blip does not send a message.
 *  Keep equal to ALERT_AFTER_MIN in supabase/functions/ingest/index.ts. */
export const ALERT_AFTER_MIN = 3;

export type HealthLevel = "online" | "offline";

export interface DeviceInfo {
  battery?: number;
  monitoring?: boolean;
  sms_permission?: boolean;
  pending?: number;
  failed?: number;
  inbox_permission?: boolean;
  recovered?: number;
  stopped_count?: number;
  last_gap_min?: number;
  notifications?: boolean;
  battery_exempt?: boolean;
  setup_complete?: boolean;
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
  const level: HealthLevel = minutes !== null && minutes * 60 >= OFFLINE_AFTER_SEC ? "offline" : "online";
  return { level, minutes, neverSpoke };
}

export function agoText(minutes: number | null): string {
  if (minutes === null) return "never";
  if (minutes < 1) return "just now";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} d ${h % 24} h ago`;
}

/** Things that stop payments being CAPTURED right now. These are worth a red banner on every page. */
export function blockingProblems(info: DeviceInfo | null | undefined): string[] {
  const out: string[] = [];
  if (!info) return out;
  if (info.sms_permission === false) out.push("SMS permission is off, so it cannot see payment messages");
  if (info.monitoring === false) out.push("Monitoring is switched off in the app, so payments are not being forwarded");
  return out;
}

/** Everything a phone reports that needs attention, in words the owner can act on. Empty when all is well.
 *  Includes the blocking problems plus ones that are worth fixing but are not losing payments right now. */
export function infoProblems(info: DeviceInfo | null | undefined): string[] {
  if (!info) return [];
  const out = blockingProblems(info);
  if (info.inbox_permission === false) {
    out.push("Reading old SMS is off, so a payment message that arrives while the phone is off cannot be recovered");
  }
  if ((info.stopped_count ?? 0) > 0) {
    const n = info.stopped_count as number;
    out.push(
      `The phone stopped PayTrace ${n} time${n === 1 ? "" : "s"} (last time for ${info.last_gap_min ?? "?"} min). Its battery manager is closing the app: check the phone's battery settings`,
    );
  }
  if (info.notifications === false) {
    out.push("Notifications are off, so Android may stop PayTrace running in the background");
  }
  if (info.battery_exempt === false) {
    out.push("Battery saver is allowed to stop PayTrace, so the phone may go offline");
  }
  if ((info.failed ?? 0) > 0) out.push(`${info.failed} message${info.failed === 1 ? "" : "s"} could not be sent`);
  return out;
}
