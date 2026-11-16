import { useState, type FormEvent } from "react";
import { sb } from "@/lib/supabase";
import { MIN_PASSWORD, passwordProblem, saveErrorText } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Two boxes and Save. The password goes straight to Supabase; the page never keeps it. */
export function NewPasswordForm({ onSaved }: { onSaved: () => void }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = passwordProblem(pw, again);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(saveErrorText(error.message, (error as { code?: string }).code));
    setPw("");
    setAgain("");
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-pw">New password</Label>
        <Input
          id="new-pw"
          type="password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD} characters. Four or five random words are easy to remember and hard to guess.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-pw-again">Type it again</Label>
        <Input
          id="new-pw-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !pw || !again} className="self-start">
        {busy ? "Saving…" : "Save new password"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
