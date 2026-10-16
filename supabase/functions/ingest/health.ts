// Phone health: what a phone reports in its heartbeat, cleaned before it is stored, and the
// problems worth telling the owner about. Pure functions, no I/O, so they can be unit tested.

export interface DeviceInfo {
  battery?: number; // percent, 0-100
  monitoring?: boolean; // the app's own on/off switch
  sms_permission?: boolean; // Android's permission to receive SMS
  pending?: number; // messages waiting to be sent
  failed?: number; // messages that ran out of retries
  app_version?: string;
  reported_at?: string;
}

// The app can send these as JSON (true) or, with the GET setting, as text ("true").
const asBool = (v: unknown): boolean | undefined =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;

const asCount = (v: unknown, max: number): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : undefined;
};

/** Keeps only the fields we know, with sane types and sizes. Whatever else arrives is dropped. */
export function cleanInfo(body: Record<string, unknown>, now: Date = new Date()): DeviceInfo {
  const info: DeviceInfo = { reported_at: now.toISOString() };
  const battery = asCount(body.battery, 100);
  if (battery !== undefined) info.battery = battery;
  const monitoring = asBool(body.monitoring);
  if (monitoring !== undefined) info.monitoring = monitoring;
  const sms = asBool(body.sms_permission);
  if (sms !== undefined) info.sms_permission = sms;
  const pending = asCount(body.pending, 1_000_000);
  if (pending !== undefined) info.pending = pending;
  const failed = asCount(body.failed, 1_000_000);
  if (failed !== undefined) info.failed = failed;
  if (typeof body.app_version === "string") {
    const v = body.app_version.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 20);
    if (v) info.app_version = v;
  }
  return info;
}

export type Problem = "monitoring_off" | "sms_permission_off";

/** A phone that is alive but cannot capture payments is as bad as a dead one. */
export function healthProblem(info: DeviceInfo | null | undefined): Problem | null {
  if (!info) return null;
  if (info.sms_permission === false) return "sms_permission_off";
  if (info.monitoring === false) return "monitoring_off";
  return null;
}
