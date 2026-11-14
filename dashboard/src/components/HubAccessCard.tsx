// The Admin Hub's own key (migration 062): it lets the Hub read the payments held for review and settle them with
// the same credit / ignore code as the Review page. Separate from website keys on purpose: a Hub key cannot create
// deposits or verify transactions, and a website key cannot touch Review.
import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Confirm } from "@/components/Confirm";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { useQuery } from "@/hooks/useQuery";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface HubKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const HUB_URL = "https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/hub";

export function HubAccessCard() {
  const { data, error, refresh } = useQuery(
    async () => must(await sb.from("hub_keys").select("id,name,key_prefix,created_at,last_used_at,revoked_at").order("created_at", { ascending: false })) as HubKey[],
    [],
    { refreshMs: 30000 },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const live = (data ?? []).filter((k) => !k.revoked_at);

  async function create() {
    setBusy(true);
    setProblem("");
    const { error: err } = await sb.rpc("create_hub_key", { p_name: "Admin Hub" });
    if (err) setProblem(err.message);
    setBusy(false);
    refresh();
  }
  async function revoke(k: HubKey) {
    setBusy(true);
    const { error: err } = await sb.rpc("revoke_hub_key", { p_id: k.id });
    if (err) setProblem(err.message);
    setBusy(false);
    refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Admin Hub access
        </CardTitle>
        <CardDescription>
          Lets your Admin Hub show the payments PayTrace is holding, next to the player's own deposit request, and credit or ignore them
          from there. Paste the key into Admin Hub under Gateway settings, PayTrace keys, "Review key". It can do nothing else.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-status-bad">{error}</p> : null}
        {problem ? <p className="text-sm text-status-bad">{problem}</p> : null}
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Hub key yet. Admin Hub can only read verifications until one exists.</p>
        ) : (
          <ul className="space-y-3">
            {live.map((k) => (
              <li key={k.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{k.name}</span>
                  <span className="text-xs text-muted-foreground">
                    made {when(k.created_at)}
                    {k.last_used_at ? ` · last used ${when(k.last_used_at)}` : " · never used yet"}
                  </span>
                </div>
                <HubKeyReveal id={k.id} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Address for the Hub:</span>
                  <code className="rounded bg-muted px-2 py-0.5">{HUB_URL}</code>
                  <CopyButton text={HUB_URL} label="Copy" />
                  <Confirm
                    title={`Revoke the Hub key ${k.key_prefix}…?`}
                    description="Admin Hub loses its Review access until a new key is pasted there."
                    confirmLabel="Revoke"
                    onConfirm={() => revoke(k)}
                  >
                    <Button variant="ghost" size="sm" className="ml-auto text-status-bad" disabled={busy}>Revoke</Button>
                  </Confirm>
                </div>
              </li>
            ))}
          </ul>
        )}
        {live.length === 0 ? (
          <Button onClick={create} disabled={busy}>
            Make the Hub key
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HubKeyReveal({ id }: { id: string }) {
  const [shown, setShown] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  async function load(): Promise<string> {
    if (key) return key;
    const { data, error } = await sb.rpc("reveal_hub_key", { p_id: id });
    if (error) {
      setProblem(error.message);
      return "";
    }
    const k = String((data as { key?: string } | null)?.key ?? "");
    setKey(k);
    return k;
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-1.5 text-xs" data-testid="hub-key">
        {shown && key ? key : "•".repeat(24)}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          if (!shown) await load();
          setShown((v) => !v);
        }}
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {shown ? "Hide" : "Show"}
      </Button>
      <CopyButton text={load} label="Copy" />
      {problem ? <span className="text-xs text-status-bad">{problem}</span> : null}
    </div>
  );
}
