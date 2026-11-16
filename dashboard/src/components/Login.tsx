import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { sb } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Login({ note, onSignedIn }: { note?: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");

  async function forgot() {
    setError("");
    setSent("");
    const to = email.trim();
    if (!to.includes("@")) return setError("Type your email above first, then press this again.");
    setBusy(true);
    // The link brings you back to this same address, where the dashboard asks for the new password.
    const { error } = await sb.auth.resetPasswordForEmail(to, { redirectTo: `${window.location.origin}/` });
    setBusy(false);
    if (error && /rate|seconds|too many/i.test(error.message)) return setError("An email was sent a moment ago. Wait a minute before asking again.");
    if (error) return setError(`The email could not be sent: ${error.message}`);
    setSent("If this is the admin's email, a reset link is on its way. Open it on this device within an hour.");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError("Sign-in failed. Check your email and password.");
    else onSignedIn();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>PayTrace</CardTitle>
          </div>
          <CardDescription>Admin sign-in</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="mt-1">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <button
              type="button"
              onClick={() => void forgot()}
              disabled={busy}
              className="self-start text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50"
            >
              Forgot your password?
            </button>
            {sent ? (
              <p role="status" className="text-sm text-muted-foreground">
                {sent}
              </p>
            ) : null}
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
