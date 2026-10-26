// Wake-up pushes: when an approved phone has been quiet for a while, ask Firebase to deliver a high-priority
// message that makes Android start PayTrace's always-on service again. The database and Firebase are passed in,
// so the decision logic can be tested without either.
//
// How hard we try (the watchdog calls this once a minute): the first push goes out when a phone has been quiet for
// 60 seconds, then again each minute for the next two tries, then every 2 minutes for as long as it stays quiet.
// From the fourth try a push carries a small visible notification (at most one per 10 minutes), because phone
// brands treat those better than silent ones. A phone that speaks again starts over from the first try.

export interface WakeRow {
  id: string; // device id
  name: string;
  token: string; // the phone's push address
  last_seen_at: string | null;
  approved_at: string | null;
  /** When we last pushed it (null = never) and how many pushes in a row went unanswered. */
  woken_at?: string | null;
  tries?: number;
  visible_at?: string | null;
}

export type WakeMode = "data" | "visible";

export interface WakeStore {
  /** Approved phones that have registered a push address. */
  candidates(): Promise<WakeRow[]>;
  /** Records the push, but only if nobody else has since (compare-and-set on the last push time). false = an overlapping run won. */
  claim(id: string, expectedWokenAt: string | null, next: { tries: number; visible: boolean }): Promise<boolean>;
  /** Forgets an address Firebase says is no longer valid (the app was reinstalled, say). */
  forget(id: string): Promise<void>;
  record(kind: string, detail: Record<string, unknown>): Promise<void>;
}

export type WakeResult = "sent" | "bad_token" | "failed";

export interface Pusher {
  enabled: boolean;
  wake(token: string, visible?: boolean): Promise<WakeResult>;
}

/** Quiet this long (the dashboard shows Offline at 90 seconds, two missed beats is 60) before the first wake-up. */
export const WAKE_AFTER_SEC = 60;
/** The first few pushes are a minute apart (a little less, so each once-a-minute run can send), then every two minutes. */
export const FAST_TRIES = 3;
export const FAST_GAP_SEC = 55;
export const SLOW_GAP_SEC = 115;
/** After this many unanswered pushes the next one carries a visible notification, at most once per this many seconds. */
export const VISIBLE_AFTER_TRIES = 3;
export const VISIBLE_GAP_SEC = 600;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Decides whether this phone gets a push now, and of which kind. Pure. */
export function planWake(d: WakeRow, now: number, afterSec = WAKE_AFTER_SEC): { mode: WakeMode; tries: number } | null {
  const seen = ms(d.last_seen_at);
  const since = seen ?? ms(d.approved_at);
  if (since === null) return null;
  if (!((now - since) / 1000 >= afterSec)) return null;

  const wokenAt = ms(d.woken_at);
  // If the phone has spoken since the last push, that push worked: start over.
  const answered = wokenAt !== null && seen !== null && seen > wokenAt;
  const tries = answered || wokenAt === null ? 0 : Math.max(0, d.tries ?? 0);

  if (wokenAt !== null && !answered) {
    const gap = tries < FAST_TRIES ? FAST_GAP_SEC : SLOW_GAP_SEC;
    if ((now - wokenAt) / 1000 < gap) return null;
  }

  const visibleAt = ms(d.visible_at);
  const visibleOk = visibleAt === null || (seen !== null && seen > visibleAt) || (now - visibleAt) / 1000 >= VISIBLE_GAP_SEC;
  const mode: WakeMode = tries >= VISIBLE_AFTER_TRIES && visibleOk ? "visible" : "data";
  return { mode, tries: tries + 1 };
}

export async function runWake(
  store: WakeStore,
  push: Pusher,
  opts: { now: number; afterSec?: number },
): Promise<{ woken: number }> {
  if (!push.enabled) return { woken: 0 };

  let woken = 0;
  for (const d of await store.candidates()) {
    const plan = planWake(d, opts.now, opts.afterSec);
    if (!plan) continue;

    // Claim first, so two overlapping runs cannot both send.
    if (!(await store.claim(d.id, d.woken_at ?? null, { tries: plan.tries, visible: plan.mode === "visible" }))) continue;

    const quietSec = Math.round((opts.now - (ms(d.last_seen_at) ?? ms(d.approved_at) ?? opts.now)) / 1000);
    const result = await push.wake(d.token, plan.mode === "visible");
    if (result === "sent") {
      woken++;
      await store.record("phone_wake_sent", { device_id: d.id, name: d.name, quiet_sec: quietSec, try: plan.tries, mode: plan.mode });
    } else if (result === "bad_token") {
      await store.forget(d.id);
      await store.record("phone_wake_bad_token", { device_id: d.id, name: d.name });
    } else {
      await store.record("phone_wake_failed", { device_id: d.id, name: d.name, try: plan.tries, mode: plan.mode });
    }
  }
  return { woken };
}
