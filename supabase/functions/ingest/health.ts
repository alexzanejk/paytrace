// Phone health: what a phone reports in its heartbeat, cleaned before it is stored, and the
// problems worth telling the owner about. Pure functions, no I/O, so they can be unit tested.

/** One wallet number saved on the phone (not secret: customers are shown it), the SIM slot chosen for it (0 = SIM 1) and
 *  whether the app found that SIM by itself or the person picked it. */
export interface WalletInfo {
  provider: string;
  number: string;
  slot: number;
  found: boolean;
  kind: "agent" | "personal"; // migration 065: an older app reports none, and those were all agent accounts
}

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
  ussd_allowed?: boolean; // the phone's own switch: may the dashboard ask it for a balance, statement or other wallet menu read
  cashin_allowed?: boolean; // the phone's own switch: may the dashboard make it send money. Off unless the owner turned it on
  app_cashin?: boolean; // this app build can do a bKash Cash In through the bKash app (migration 082)
  app_trx?: boolean; // this app build opens bKash app rows and reads their TrxID (migration 086)
  app_balance?: boolean; // this app build reads the bKash balance through the bKash app (migration 089)
  admin_code_set?: boolean; // an admin code protects those switches (the code itself is never sent)
  accessibility_on?: boolean; // PayTrace's balance-check service is switched on in the phone's Accessibility settings
  accessibility_running?: boolean; // ...and Android has really started it (a killed app leaves it on but dead: "malfunctioning")
  accessibility_repairs?: number; // times the phone switched that dead service off and on by itself (needs the adb grant)
  wallets?: WalletInfo[]; // the wallet numbers saved on the phone and which SIM each is in
  sim_keys?: string; // the extra names (never values) on the last SMS broadcast whose SIM the app could not read
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
  const ussdAllowed = asBool(body.ussd_allowed);
  if (ussdAllowed !== undefined) info.ussd_allowed = ussdAllowed;
  const cashinAllowed = asBool(body.cashin_allowed);
  if (cashinAllowed !== undefined) info.cashin_allowed = cashinAllowed;
  const appCashIn = asBool(body.app_cashin);
  if (appCashIn !== undefined) info.app_cashin = appCashIn;
  const appTrx = asBool(body.app_trx);
  if (appTrx !== undefined) info.app_trx = appTrx;
  const appBalance = asBool(body.app_balance);
  if (appBalance !== undefined) info.app_balance = appBalance;
  const adminCodeSet = asBool(body.admin_code_set);
  if (adminCodeSet !== undefined) info.admin_code_set = adminCodeSet;
  const a11yOn = asBool(body.accessibility_on);
  if (a11yOn !== undefined) info.accessibility_on = a11yOn;
  const a11yRunning = asBool(body.accessibility_running);
  if (a11yRunning !== undefined) info.accessibility_running = a11yRunning;
  const a11yRepairs = asCount(body.accessibility_repairs, 1_000_000);
  if (a11yRepairs !== undefined) info.accessibility_repairs = a11yRepairs;
  if (Array.isArray(body.wallets)) {
    const wallets: WalletInfo[] = [];
    for (const w of body.wallets.slice(0, 6)) {
      if (!w || typeof w !== "object") continue;
      const o = w as Record<string, unknown>;
      const provider = typeof o.provider === "string" && /^(bkash|nagad|rocket|upay)$/.test(o.provider) ? o.provider : null;
      const number = typeof o.number === "string" && /^01[0-9]{9}$/.test(o.number) ? o.number : null;
      // Exactly SIM 1 or SIM 2; a slot like 5 is not rounded down to a SIM the phone may not have.
      const slot = o.slot === 0 || o.slot === "0" ? 0 : o.slot === 1 || o.slot === "1" ? 1 : undefined;
      const found = asBool(o.found);
      const kind = o.kind === "personal" ? "personal" : "agent";
      if (provider && number && slot !== undefined) wallets.push({ provider, number, slot, found: found === true, kind });
    }
    if (wallets.length) info.wallets = wallets;
  }
  if (typeof body.sim_keys === "string") {
    const k = body.sim_keys.replace(/[^A-Za-z0-9_.,:-]/g, "").slice(0, 200);
    if (k) info.sim_keys = k;
  }
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
