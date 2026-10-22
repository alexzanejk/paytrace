import { useState, type FormEvent } from "react";
import { Webhook } from "lucide-react";
import { sb } from "@/lib/supabase";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  revoked_at: string | null;
  webhook_url: string | null;
}

/** Where PayTrace tells a website that a deposit was paid. The signing secret is shown once, like an API key. */
export function WebhookCard({ keys, onChanged }: { keys: KeyRow[]; onChanged: () => void }) {
  const active = keys.filter((k) => !k.revoked_at);
  const [keyId, setKeyId] = useState("");
  const chosen = active.find((k) => k.id === keyId) ?? active[0];
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  async function save(e: FormEvent, clear = false) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setProblem("");
    const { data, error } = await sb.rpc("set_key_webhook", { p_id: chosen.id, p_url: clear ? "" : url });
    setBusy(false);
    if (error) return setProblem(error.message);
    const made = (data as { secret?: string | null } | null)?.secret;
    setSecret(made ? { name: chosen.name, value: made } : null);
    setUrl("");
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-4 w-4" aria-hidden /> Where to send payment results
        </CardTitle>
        <CardDescription>
          When a deposit is paid, held or expires, PayTrace sends a signed message to this address on your website's server. Without
          one, the website can still ask for the result.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Make a key first (below), then come back to set its address.</p>
        ) : (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-1">
              <Label>Key</Label>
              <Select value={chosen?.id ?? ""} onValueChange={setKeyId}>
                <SelectTrigger aria-label="Key"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {active.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="hook-url">Address (https)</Label>
              <Input id="hook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourshop.com/paytrace-webhook" />
            </div>
            <Button type="submit" disabled={busy || !url.trim()}>{busy ? "Saving…" : "Save"}</Button>
          </form>
        )}
        {chosen ? (
          <p className="text-sm text-muted-foreground">
            Now for "{chosen.name}": {chosen.webhook_url ? <code className="break-all text-xs">{chosen.webhook_url}</code> : "no address set"}
            {chosen.webhook_url ? (
              <Button type="button" variant="ghost" size="sm" className="ml-2" disabled={busy} onClick={(e) => void save(e, true)}>
                Turn off
              </Button>
            ) : null}
          </p>
        ) : null}
        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
        {secret ? (
          <div className="grid gap-2 rounded-lg border border-primary p-3">
            <p className="text-sm font-medium">Signing secret for "{secret.name}" (shown once)</p>
            <code className="break-all rounded-lg border border-border bg-muted px-3 py-2 text-sm" data-testid="hook-secret">{secret.value}</code>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={secret.value} label="Copy secret" variant="default" />
              <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>I have saved it</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Give this to your developer, who uses it to check that a message really came from PayTrace. It is not shown again; changing the address keeps the same secret.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
