import { useEffect, useState } from "react";
import { INGEST_URL, must, sb } from "@/lib/supabase";
import { PROVIDERS, PROVIDER_LABEL, type Settings } from "@/lib/types";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function SettingsPage({ onSaved }: { onSaved: (s: Settings) => void }) {
  const { data, error, loading } = useQuery(
    async () => must(await sb.from("settings").select("*").single()) as Settings,
    [],
  );

  const [enabled, setEnabled] = useState<string[]>([]);
  const [minutes, setMinutes] = useState("60");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled_providers);
    setMinutes(String(data.order_expiry_minutes));
  }, [data]);

  async function save() {
    setBusy(true);
    const expiry = Math.max(1, Number(minutes) || 60);
    const { error } = await sb
      .from("settings")
      .update({ enabled_providers: enabled, order_expiry_minutes: expiry, updated_at: new Date().toISOString() })
      .eq("id", true);
    setBusy(false);
    setNote(error ? error.message : "Saved.");
    if (!error) onSaved({ enabled_providers: enabled, order_expiry_minutes: expiry });
  }

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Server settings</CardTitle>
            <CardDescription>These apply to every connected phone.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Payment services the server accepts</p>
              <div className="flex flex-col gap-3">
                {PROVIDERS.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-4">
                    <Label htmlFor={`prov-${p}`}>{PROVIDER_LABEL[p]}</Label>
                    <Switch
                      id={`prov-${p}`}
                      checked={enabled.includes(p)}
                      onCheckedChange={(on) =>
                        setEnabled((list) => (on ? [...new Set([...list, p])] : list.filter((x) => x !== p)))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expiry">An order expires after (minutes)</Label>
              <Input
                id="expiry"
                type="number"
                min={1}
                className="w-32"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              {note ? <span className="text-sm text-muted-foreground">{note}</span> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connecting a phone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Phones connect themselves: open the app, then approve the code it shows under Devices. No address or
              secret is typed on the phone.
            </p>
            <p className="break-all">
              Server address built into the app: <code className="font-mono text-xs">{INGEST_URL}</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </Screen>
  );
}
