import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { sb } from "@/lib/supabase";
import { tk } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The daily allowance for cash-ins the DASHBOARD asks a phone to make (the Phones page, each phone's "Cash in from this
 *  phone"). Nothing to do with the partner's own cash-in jobs above.
 *
 *  It starts at 0, which switches the whole thing off. One command can never be more than 10,000 Tk whatever is set here:
 *  that cap is written into the database itself, and the phone checks it again. */
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
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" aria-hidden /> Cash-in from the dashboard</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          How much each phone may send in one day when YOU ask it to from the Phones page. {limit === 0
            ? "It is 0 now, which means no cash-in can be asked for at all."
            : `It is ${tk(limit ?? 0)} a day per phone now.`}
          {" "}One cash-in can never be more than {tk(10000)}, and the phone must also have its own cash-in switch turned on.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); setSaved(false); }}
            inputMode="numeric"
            aria-label="Taka each phone may cash in per day from the dashboard"
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
