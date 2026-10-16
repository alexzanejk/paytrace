import { useState, type FormEvent } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { sb } from "@/lib/supabase";
import { cleanCode } from "@/lib/mfa";
import { useQuery } from "@/hooks/useQuery";
import { Confirm } from "@/components/Confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

/** Turns two-step login on or off. Once on, a stolen password alone no longer opens the dashboard. */
export function TwoStepCard() {
  const { data: factors, loading, refresh } = useQuery(async () => {
    const { data } = await sb.auth.mfa.listFactors();
    return data?.totp ?? [];
  }, []);

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const on = (factors?.length ?? 0) > 0;

  async function start() {
    setBusy(true);
    setError("");
    // A half-finished earlier attempt would block a new one, so clear it first.
    const { data: all } = await sb.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `PayTrace ${Math.random().toString(36).slice(2, 6)}`,
    });
    setBusy(false);
    if (error || !data) return setError(error?.message ?? "Could not start setup. Try again.");
    // The library's type also allows phone factors; only authenticator apps are used here.
    if (data.type !== "totp") return setError("Could not start setup. Try again.");
    setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!enrolment) return;
    setBusy(true);
    setError("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enrolment.factorId, code: cleanCode(code) });
    setBusy(false);
    if (error) return setError("That code did not match. Check the phone's clock is correct and try the next code.");
    setEnrolment(null);
    setCode("");
    refresh();
  }

  async function cancel() {
    if (enrolment) await sb.auth.mfa.unenroll({ factorId: enrolment.factorId });
    setEnrolment(null);
    setCode("");
    setError("");
  }

  async function turnOff() {
    const target = factors?.[0];
    if (!target) return;
    const { error } = await sb.auth.mfa.unenroll({ factorId: target.id });
    if (error) setError(error.message);
    refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {on ? <ShieldCheck className="h-5 w-5 text-status-ok" aria-hidden /> : <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden />}
          <CardTitle>Two-step login</CardTitle>
        </div>
        <CardDescription>
          {on
            ? "On. Signing in needs your password and a 6-digit code from your authenticator app."
            : "Off. Anyone who learns your password can open this dashboard. Turn it on to also require a code from your phone."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading && !factors ? <p className="text-sm text-muted-foreground">Checking…</p> : null}

        {!loading && !on && !enrolment ? (
          <div>
            <Button onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Set up two-step login"}
            </Button>
          </div>
        ) : null}

        {enrolment ? (
          <form onSubmit={confirm} className="flex flex-col gap-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Open an authenticator app on your phone — Google Authenticator, Microsoft Authenticator, Authy or 1Password. Pick one
                that <strong>backs itself up</strong>, so a lost phone does not lock you out.
              </li>
              <li>Scan this picture (or type the key under it).</li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <img src={enrolment.qr} alt="QR code to scan with your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" />
            <p className="break-all font-mono text-xs text-muted-foreground">Key: {enrolment.secret}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="setup-code">6-digit code</Label>
              <Input
                id="setup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-40 text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value))}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Turn on"}
              </Button>
              <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {on && !enrolment ? (
          <div>
            <Confirm
              title="Turn off two-step login?"
              description="Your password alone will open the dashboard again. Only do this if you are replacing your authenticator app."
              confirmLabel="Turn off"
              onConfirm={turnOff}
            >
              <Button variant="outline">Turn off</Button>
            </Confirm>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
