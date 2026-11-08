import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The daily allowance for money sent from a PERSONAL account by Send Money (owner 2026-11-08: "for personal sent money
 *  only, cash-in does not have a limit"). Since migration 065 an agent Cash In from the dashboard (Payout page, a phone's
 *  Cash-in button) has no daily limit; one cash-in is still 100 to 50,000 Tk, in the database and on the phone.
 *  Sending from a personal account is not built yet, so this number waits for it. */
export function CashInCommandLimit() {
  const [limit, setLimit] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await sb.from("cashin_limits").select("daily_limit").limit(1);
      const row = (data ?? [])[0] as { daily_limit: number } | undefined;
      const n = row ? Number(row.daily_limit) : 0;
      setLimit(n);
      setText(String(n));
    })();
  }, []);

  async function save() {
    const n = Number(text.replace(/,/g, "").trim());
    setProblem("");
    setSaved(false);
    if (!Number.isFinite(n) || n < 0 || n > 1000000) return setProblem("Type a number between 0 and 1,000,000.");
    setSaving(true);
    const { error } = await sb.rpc("set_cashin_command_limit", { p_daily: n });
    setSaving(false);
    if (error) return setProblem(error.message);
    setLimit(n);
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" aria-hidden /> Daily limit for personal Send Money</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          How much a personal account on one phone may send by Send Money in one day. {limit === 0
            ? "It is 0 now, which means none."
            : `It is ${tk(limit ?? 0)} a day per phone now.`}
          {" "}Sending from a personal account is not built yet; this limit is ready for it. An agent Cash In (Payout page, or a
          phone's Cash-in button) has NO daily limit: one cash-in is between {tk(100)} and {tk(50000)}, and the phone must be
          allowed to send money (Phones page).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setSaved(false); }}
            inputMode="numeric"
            aria-label="Taka a personal account may send per day"
            className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button size="sm" onClick={() => void save()} disabled={saving}>Save limit</Button>
          <Button size="sm" variant="ghost" onClick={() => { setText("0"); }}>Switch off</Button>
        </div>
        {saved ? <p className="text-sm text-emerald-600">Saved.</p> : null}
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      </CardContent>
    </Card>
  );
}
