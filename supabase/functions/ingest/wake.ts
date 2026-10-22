// Wake-up pushes: when an approved phone has been quiet for a while, ask Firebase to deliver a high-priority
// message that makes Android start PayTrace's always-on service again. The database and Firebase are passed in,
// so the decision logic can be tested without either.

export interface WakeRow {
  id: string; // device id
  name: string;
  token: string; // the phone's push address
  last_seen_at: string | null;
  approved_at: string | null;
}

export interface WakeStore {
  /** Approved phones that have registered a push address. */
  candidates(): Promise<WakeRow[]>;
  /** Marks the phone as woken now. false if it was woken more recently than the cool-down (or by an overlapping run). */
  claim(id: string, cooldownMin: number): Promise<boolean>;
  /** Forgets an address Firebase says is no longer valid (the app was reinstalled, say). */
  forget(id: string): Promise<void>;
  record(kind: string, detail: Record<string, unknown>): Promise<void>;
}

export type WakeResult = "sent" | "bad_token" | "failed";

export interface Pusher {
  enabled: boolean;
  wake(token: string): Promise<WakeResult>;
}

/** Quiet this long (the dashboard shows Offline at 90 seconds) before the first wake-up is sent. */
export const WAKE_AFTER_SEC = 100;
/** Do not wake the same phone more often than this. A phone that is really off just ignores it. */
export const WAKE_COOLDOWN_MIN = 10;

export async function runWake(
  store: WakeStore,
  push: Pusher,
  opts: { now: number; afterSec?: number; cooldownMin?: number },
): Promise<{ woken: number }> {
  if (!push.enabled) return { woken: 0 };
  const afterSec = opts.afterSec ?? WAKE_AFTER_SEC;
  const cooldown = opts.cooldownMin ?? WAKE_COOLDOWN_MIN;

  let woken = 0;
  for (const d of await store.candidates()) {
    const since = d.last_seen_at ?? d.approved_at;
    if (!since) continue;
    const quietSec = (opts.now - new Date(since).getTime()) / 1000;
    if (!(quietSec >= afterSec)) continue;

    // Claim first, so two overlapping runs cannot both send.
    if (!(await store.claim(d.id, cooldown))) continue;

    const result = await push.wake(d.token);
    if (result === "sent") {
      woken++;
      await store.record("phone_wake_sent", { device_id: d.id, name: d.name, quiet_sec: Math.round(quietSec) });
    } else if (result === "bad_token") {
      await store.forget(d.id);
      await store.record("phone_wake_bad_token", { device_id: d.id, name: d.name });
    } else {
      await store.record("phone_wake_failed", { device_id: d.id, name: d.name });
    }
  }
  return { woken };
}
