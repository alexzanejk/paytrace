// Decides which phones have gone quiet and alerts the owner once for each. The database access is
// passed in (WatchStore), so the claim / send / release logic can be tested without a database.
import { silentMessage, type Notifier } from "./notify.ts";

export interface WatchRow {
  id: string;
  name: string;
  pair_code: string;
  last_seen_at: string | null;
  approved_at: string | null;
}

export interface WatchStore {
  /** Approved phones that have not already been alerted about. */
  candidates(): Promise<WatchRow[]>;
  /** Marks the phone as alerted. false if someone else already did (an overlapping run). */
  claim(id: string): Promise<boolean>;
  /** Undoes a claim so the next run can try again. */
  release(id: string): Promise<void>;
  record(kind: string, detail: Record<string, unknown>): Promise<void>;
}

export async function runWatchdog(
  store: WatchStore,
  notify: Notifier,
  opts: { now: number; silentAfterMin: number; dashboardUrl: string },
): Promise<{ alerted: number }> {
  // Nobody to tell: leave the phones un-alerted, so they are reported once Telegram is set up.
  if (!notify.enabled) return { alerted: 0 };

  let alerted = 0;
  for (const d of await store.candidates()) {
    // A phone that never spoke is judged from the moment it was approved.
    const since = d.last_seen_at ?? d.approved_at;
    if (!since) continue;
    const minutes = (opts.now - new Date(since).getTime()) / 60000;
    if (!(minutes >= opts.silentAfterMin)) continue;

    // Claim first, so two overlapping runs cannot both send the same alert.
    if (!(await store.claim(d.id))) continue;

    const sent = await notify.send(
      silentMessage({ name: d.name, code: d.pair_code, minutes, dashboardUrl: opts.dashboardUrl }),
    );
    if (sent) {
      await store.record("phone_silent", { device_id: d.id, name: d.name, minutes: Math.round(minutes) });
      alerted++;
    } else {
      await store.release(d.id);
    }
  }
  return { alerted };
}
