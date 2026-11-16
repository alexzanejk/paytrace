import { useState } from "react";
import { KeyRound } from "lucide-react";
import { NewPasswordForm } from "@/components/NewPassword";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Settings: change the admin password while signed in. */
export function PasswordCard() {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden />
          <CardTitle>Password</CardTitle>
        </div>
        <CardDescription>Change the password you sign in with. Your two-step code stays the same.</CardDescription>
      </CardHeader>
      <CardContent>
        {saved ? (
          <p role="status" className="text-sm text-status-ok">
            Saved. Use the new password next time you sign in.
          </p>
        ) : (
          <NewPasswordForm onSaved={() => setSaved(true)} />
        )}
      </CardContent>
    </Card>
  );
}
