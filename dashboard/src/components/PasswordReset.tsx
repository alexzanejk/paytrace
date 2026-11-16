import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { needsSecondStep } from "@/lib/mfa";
import { MfaChallenge } from "@/components/MfaChallenge";
import { NewPasswordForm } from "@/components/NewPassword";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Where the "reset your password" email lands. With two-step login on, the code comes first:
 *  Supabase will not change the password of such an account without it. */
export function PasswordReset({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"checking" | "code" | "form">("checking");

  useEffect(() => {
    void needsSecondStep().then((code) => setStep(code ? "code" : "form"));
  }, []);

  if (step === "checking") return <main className="p-6 text-muted-foreground">Loading…</main>;
  if (step === "code") return <MfaChallenge onVerified={() => setStep("form")} />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            <CardTitle>Choose a new password</CardTitle>
          </div>
          <CardDescription>You opened the reset link from your email. Type the new password twice.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm onSaved={onDone} />
        </CardContent>
      </Card>
    </main>
  );
}
