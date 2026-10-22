import { useState } from "react";
import { Palette } from "lucide-react";
import { sb } from "@/lib/supabase";
import { RESULT_STYLE_NAMES } from "@/pay/ResultScreens";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface KeyRow {
  id: string;
  name: string;
  revoked_at: string | null;
  result_style: number | null;
}

const AUTO = "auto";

/** Which look a site's customers see after pressing Confirm. Different sites get different looks so none are identical. */
export function ResultStyleCard({ keys, onChanged }: { keys: KeyRow[]; onChanged: () => void }) {
  const active = keys.filter((k) => !k.revoked_at);
  const [keyId, setKeyId] = useState("");
  const chosen = active.find((k) => k.id === keyId) ?? active[0];
  const [pick, setPick] = useState<string | null>(null);
  const current = pick ?? (chosen?.result_style === null || chosen?.result_style === undefined ? AUTO : String(chosen.result_style));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setNote("");
    const { error } = await sb.rpc("set_key_result_style", { p_id: chosen.id, p_style: current === AUTO ? null : Number(current) });
    setBusy(false);
    if (error) return setNote(error.message);
    setNote("Saved.");
    setPick(null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-4 w-4" aria-hidden /> How the result page looks
        </CardTitle>
        <CardDescription>
          After a customer presses Confirm they see a waiting screen, then paid, held or expired. There are six looks, so sites that use PayTrace do
          not all show the same result page. Automatic gives each site its own look that never changes. The submission page itself is the same for everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Make a key first (below), then come back to choose its look.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-1">
              <Label>Key</Label>
              <Select value={chosen?.id ?? ""} onValueChange={(v) => { setKeyId(v); setPick(null); setNote(""); }}>
                <SelectTrigger aria-label="Key"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {active.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Look</Label>
              <Select value={current} onValueChange={(v) => { setPick(v); setNote(""); }}>
                <SelectTrigger aria-label="Look"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Automatic</SelectItem>
                  {RESULT_STYLE_NAMES.map((n, i) => (
                    <SelectItem key={n} value={String(i)}>{i + 1}. {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/pay?demo=1&style=${current === AUTO ? 0 : current}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
            Preview the looks
          </a>
          <span className="text-xs text-muted-foreground">Opens the preview page. Use the "After Confirm, look" buttons at the top, enter any TrxID and press Confirm.</span>
        </div>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}
