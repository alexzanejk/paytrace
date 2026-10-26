// Sends the wake-up message through Firebase Cloud Messaging (HTTP v1). The service account key is an Edge Function
// secret (FIREBASE_SERVICE_ACCOUNT) that only the owner sets. Nothing here ever logs it, the access token or a push address.
import type { Pusher, WakeResult } from "./wake.ts";

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function parseAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (typeof o.project_id === "string" && typeof o.client_email === "string" && typeof o.private_key === "string") return o;
  } catch {
    // fall through
  }
  return null;
}

/** The body of the message: a data message the app's WakeService receives. Short lifetime, so a phone that is
 *  switched off does not get a stale wake-up hours later. The "visible" kind (sent after several unanswered tries)
 *  also carries a small notification, which phone brands deliver more reliably; tapping it opens the app. */
export const wakeMessage = (token: string, visible = false) => ({
  message: {
    token,
    data: { type: "wake" },
    ...(visible ? { notification: { title: "PayTrace", body: "Tap to keep PayTrace running." } } : {}),
    android: { priority: "HIGH", ttl: visible ? "120s" : "60s" },
  },
});

export function makePusher(serviceAccountJson: string | undefined, fetchImpl: typeof fetch = fetch): Pusher {
  const account = parseAccount(serviceAccountJson);
  let cached: { token: string; expires: number } | null = null;

  async function accessToken(a: ServiceAccount): Promise<string | null> {
    if (cached && cached.expires - 60_000 > Date.now()) return cached.token;
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = b64url(JSON.stringify({
        iss: a.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }));
      const key = await crypto.subtle.importKey(
        "pkcs8", pemToDer(a.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
      );
      const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
      const res = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${header}.${claims}.${b64url(sig)}`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.error("firebase sign-in rejected, status", res.status);
        return null;
      }
      const j = await res.json();
      if (typeof j.access_token !== "string") return null;
      cached = { token: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
      return cached.token;
    } catch {
      console.error("firebase sign-in failed");
      return null;
    }
  }

  return {
    enabled: account !== null,
    async wake(token: string, visible = false): Promise<WakeResult> {
      if (!account) return "failed";
      const access = await accessToken(account);
      if (!access) return "failed";
      try {
        const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
          body: JSON.stringify(wakeMessage(token, visible)),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return "sent";
        // 404 UNREGISTERED: the app was uninstalled or its address changed. 400 INVALID_ARGUMENT: not a valid address.
        if (res.status === 404 || res.status === 400) return "bad_token";
        console.error("firebase rejected the wake-up, status", res.status);
        return "failed";
      } catch {
        console.error("firebase wake-up request failed");
        return "failed";
      }
    },
  };
}
