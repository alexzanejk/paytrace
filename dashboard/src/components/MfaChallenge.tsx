import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { sb } from "@/lib/supabase";
import { cleanCode } from "@/lib/mfa";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Shown after the password, when the admin has two-step login switched on. */
export function MfaChallenge({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data: factors } = await sb.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    if (!factor) {
      setBusy(false);
      return setError("No authenticator is set up on this account. Sign out and try again.");
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: cleanCode(code) });
    setBusy(false);
    if (error) {
      setCode("");
      return setError("That code did not work. Wait for a new one in your authenticator app and try again.");
    }
    onVerified();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>Two-step login</CardTitle>
          </div>
          <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={12}
                className="text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value))}
              />
            </div>
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Continue"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void sb.auth.signOut()}>
              Sign out
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
