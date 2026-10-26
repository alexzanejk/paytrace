import { INGEST_URL, sb } from "@/lib/supabase";

export type WakeOutcome = "sent" | "signed_out" | "no_firebase" | "not_registered" | "rejected" | "failed";

/** Sends one wake-up push to one phone, as the signed-in admin. The phone confirms in its next heartbeat. */
export async function wakePhone(deviceId: string): Promise<WakeOutcome> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "signed_out";
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "test_wake", device_id: deviceId }),
    });
    const b = (await res.json().catch(() => ({}))) as { configured?: boolean; registered?: boolean; result?: string };
    if (!res.ok) return "failed";
    if (!b.configured) return "no_firebase";
    if (!b.registered) return "not_registered";
    return b.result === "sent" ? "sent" : "rejected";
  } catch {
    return "failed";
  }
}

export const WAKE_TEXT: Record<WakeOutcome, string> = {
  sent: "Sent to Google. If the phone is on and has internet it should be back within a minute or two.",
  signed_out: "You are signed out. Sign in again and retry.",
  no_firebase: "Firebase is not set up on the server yet (the FIREBASE_SERVICE_ACCOUNT secret).",
  not_registered: "This phone has not registered for wake-ups. Install the newest app and open it once.",
  rejected: "Google did not accept the message. Try again in a minute.",
  failed: "Could not reach the server. Check your internet and try again.",
};
