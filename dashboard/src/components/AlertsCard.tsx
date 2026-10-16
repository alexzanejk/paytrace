import { useState } from "react";
import { BellRing } from "lucide-react";
import { INGEST_URL, sb } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Result = { tone: "ok" | "warn" | "bad"; text: string };

/** Sends one Telegram message, so setup can be confirmed without waiting for a real alert. */
export function AlertsCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function sendTest() {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return setResult({ tone: "bad", text: "You are signed out. Sign in again and retry." });
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "test_alert" }),
      });
      const body = (await res.json().catch(() => ({}))) as { configured?: boolean; sent?: boolean; message?: string };
      if (!res.ok) return setResult({ tone: "bad", text: `Could not send: ${body.message ?? res.status}.` });
      if (!body.configured) {
        return setResult({
          tone: "warn",
          text: "Telegram is not set up yet. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Supabase (Edge Functions → Secrets), then try again.",
        });
      }
      if (!body.sent) {
        return setResult({
          tone: "bad",
          text: "Telegram refused the message. Check the bot token and chat ID, and that you pressed Start in your bot's chat.",
        });
      }
      setResult({ tone: "ok", text: "Sent. Check Telegram — you should see the test message now." });
    } catch {
      setResult({ tone: "bad", text: "Could not reach the server. Check your internet and try again." });
    } finally {
      setBusy(false);
    }
  }

  const color = { ok: "text-status-ok", warn: "text-status-warn", bad: "text-destructive" } as const;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle>Telegram alerts</CardTitle>
        </div>
        <CardDescription>
          You are messaged when a payment is held for review, when a phone goes quiet, and when a phone cannot capture
          payments.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button onClick={sendTest} disabled={busy} variant="outline">
            {busy ? "Sending…" : "Send a test message"}
          </Button>
        </div>
        {result ? (
          <p role="status" className={`text-sm ${color[result.tone]}`}>
            {result.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
