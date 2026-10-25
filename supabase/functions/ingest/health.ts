// Phone health: what a phone reports in its heartbeat, cleaned before it is stored, and the
// problems worth telling the owner about. Pure functions, no I/O, so they can be unit tested.

export interface DeviceInfo {
  battery?: number; // percent, 0-100
  monitoring?: boolean; // the app's own on/off switch
  sms_permission?: boolean; // Android's permission to receive SMS
  pending?: number; // messages waiting to be sent
  failed?: number; // messages that ran out of retries
  inbox_permission?: boolean; // Android's permission to read old SMS, which missed-message recovery needs
  recovered?: number; // missed messages the inbox scan has picked up since the app was installed
  stopped_count?: number; // times the phone's power manager stopped the app (gap of 5+ min while the phone stayed on)
  last_gap_min?: number; // length of the most recent such stop
  default_sms?: boolean; // PayTrace is the phone's default SMS app (optional "SMS app mode")
  notifications?: boolean; // notifications allowed (the app's always-on notice needs them)
  battery_exempt?: boolean; // Android's battery saver is told to leave the app alone
  setup_complete?: boolean; // every permission and setting the app requires is in place
  wake_count?: number; // wake-up pushes this phone has received
  last_wake_at?: string; // when the latest one arrived
  push_ready?: boolean; // the phone has a Firebase push address, so the server can wake it
  keepalive_test?: "pass" | "fail" | "short"; // the owner's screen-off test: did the phone stop the app while the screen was off?
  keepalive_test_at?: string; // when that test finished
  keepalive_gap_s?: number; // the longest silence during it, in seconds
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
  const inbox = asBool(body.inbox_permission);
  if (inbox !== undefined) info.inbox_permission = inbox;
  const recovered = asCount(body.recovered, 1_000_000);
  if (recovered !== undefined) info.recovered = recovered;
  const stopped = asCount(body.stopped_count, 1_000_000);
  if (stopped !== undefined) info.stopped_count = stopped;
  const gap = asCount(body.last_gap_min, 1_000_000);
  if (gap !== undefined) info.last_gap_min = gap;
  const defaultSms = asBool(body.default_sms);
  if (defaultSms !== undefined) info.default_sms = defaultSms;
  const notifications = asBool(body.notifications);
  if (notifications !== undefined) info.notifications = notifications;
  const batteryExempt = asBool(body.battery_exempt);
  if (batteryExempt !== undefined) info.battery_exempt = batteryExempt;
  const setupComplete = asBool(body.setup_complete);
  if (setupComplete !== undefined) info.setup_complete = setupComplete;
  const wakes = asCount(body.wake_count, 1_000_000);
  if (wakes !== undefined) info.wake_count = wakes;
  // The phone sends the time as milliseconds since 1970; only a believable one is kept.
  const wakeAt = typeof body.last_wake_at === "number" ? body.last_wake_at : Number(body.last_wake_at);
  if (Number.isFinite(wakeAt) && wakeAt > Date.parse("2020-01-01") && wakeAt < now.getTime() + 864e5) {
    info.last_wake_at = new Date(wakeAt).toISOString();
  }
  const test = body.keepalive_test;
  if (test === "pass" || test === "fail" || test === "short") {
    info.keepalive_test = test;
    const testAt = typeof body.keepalive_test_at === "number" ? body.keepalive_test_at : Number(body.keepalive_test_at);
    if (Number.isFinite(testAt) && testAt > Date.parse("2020-01-01") && testAt < now.getTime() + 864e5) {
      info.keepalive_test_at = new Date(testAt).toISOString();
    }
    const testGap = asCount(body.keepalive_gap_s, 1_000_000);
    if (testGap !== undefined) info.keepalive_gap_s = testGap;
  }
  const pushReady = asBool(body.push_ready);
  if (pushReady !== undefined) info.push_ready = pushReady;
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
