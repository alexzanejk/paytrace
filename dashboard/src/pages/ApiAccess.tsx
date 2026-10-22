import { useState, type FormEvent } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { depositInstructions, developerInstructions, GATEWAY_URL, VERIFY_URL } from "@/lib/apiDocs";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { EmptyRow } from "@/components/Empty";
import { Confirm } from "@/components/Confirm";
import { CopyButton } from "@/components/CopyButton";
import { WebhookCard } from "@/components/WebhookCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  webhook_url: string | null;
}

interface NewKey {
  id: string;
  name: string;
  key: string;
}

/** Make and revoke the keys your websites use to check transaction IDs, and copy what a developer needs. */
export function ApiAccess() {
  const { data, error, loading, refresh } = useQuery(
    async () =>
      must(
        await sb
          .from("api_keys")
          .select("id,name,key_prefix,created_at,last_used_at,revoked_at,webhook_url")
          .order("created_at", { ascending: false }),
      ) as ApiKey[],
    [],
    { refreshMs: 15000 },
  );

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Held only in this page's memory: shown once, never stored in the browser.
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [revokeError, setRevokeError] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    const { data: made, error: err } = await sb.rpc("create_api_key", { p_name: name });
    setBusy(false);
    if (err) return setProblem(err.message);
    setFresh(made as NewKey);
    setName("");
    refresh();
  }

  async function revoke(k: ApiKey) {
    setRevokeError("");
    const { error: err } = await sb.rpc("revoke_api_key", { p_id: k.id });
    if (err) return setRevokeError(err.message);
    if (fresh?.id === k.id) setFresh(null);
    refresh();
  }

  const keys = data ?? [];

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Let your websites check transaction IDs</CardTitle>
            <CardDescription>
              Your website admin and super-admin servers can ask PayTrace whether a customer's transaction ID really
              arrived, and for how much. Make one key per server, copy the instructions, and send both to your developer.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <Label>Endpoint (the address your servers call)</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs">{VERIFY_URL}</code>
                <CopyButton text={VERIFY_URL} label="Copy endpoint" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={() => developerInstructions()} label="Copy instructions for the developer" variant="default" />
              <span className="text-xs text-muted-foreground">
                Plain text with the endpoint, how to call it and what to show for each answer. It does not include any key.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accept deposits on your websites</CardTitle>
            <CardDescription>
              Your website's server creates a deposit order, sends the customer to a PayTrace pay page, and PayTrace tells the
              website when it is paid. The customer pays one of your phones' numbers and enters the transaction ID. Set the
              numbers on each phone in the Phones tab first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <Label>Endpoint (the address your servers call)</Label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs">{GATEWAY_URL}/create-deposit</code>
                <CopyButton text={`${GATEWAY_URL}/create-deposit`} label="Copy endpoint" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={() => depositInstructions()} label="Copy deposit instructions for the developer" variant="default" />
              <span className="text-xs text-muted-foreground">Plain text; it does not include any key. Uses the same keys as below.</span>
            </div>
          </CardContent>
        </Card>

        <WebhookCard keys={keys} onChanged={refresh} />

        {fresh ? (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" aria-hidden />
                Key for "{fresh.name}"
              </CardTitle>
              <CardDescription className="flex items-start gap-1.5 text-status-warn">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Copy it now. This is the only time it is shown; PayTrace keeps only a scrambled version and cannot show it
                again. If you lose it, revoke it and make a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <code className="break-all rounded-lg border border-border bg-muted px-3 py-2 text-sm" data-testid="new-key">
                {fresh.key}
              </code>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={fresh.key} label="Copy key" variant="default" />
                <CopyButton text={() => developerInstructions(fresh.key)} label="Copy instructions with this key" />
                <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
                  I have saved it
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Whoever holds this key can look up transaction IDs and their amounts. Send it only to the developer, store it in
                the server's settings, and never put it in a web page or app.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Make a new key</CardTitle>
            <CardDescription>Give it the name of the server that will use it, for example "Website admin".</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-wrap items-end gap-3">
              <div className="grid min-w-56 flex-1 gap-1">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Website admin" />
              </div>
              <Button type="submit" disabled={busy || name.trim().length === 0}>
                {busy ? "Making…" : "Make key"}
              </Button>
            </form>
            {problem ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
          </CardContent>
        </Card>

        <section>
          <h3 className="mb-2 text-base font-semibold">Your keys</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Starts with</TableHead>
                <TableHead>Made (BD)</TableHead>
                <TableHead>Last used (BD)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 ? (
                <EmptyRow cols={6} text="No keys yet. Make one above." />
              ) : (
                keys.map((k) => (
                  <TableRow key={k.id} className={k.revoked_at ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                    <TableCell>{when(k.created_at)}</TableCell>
                    <TableCell>{k.last_used_at ? when(k.last_used_at) : "never"}</TableCell>
                    <TableCell>
                      <Badge tone={k.revoked_at ? "idle" : "ok"}>{k.revoked_at ? "Revoked" : "Active"}</Badge>
                    </TableCell>
                    <TableCell>
                      {k.revoked_at ? null : (
                        <Confirm
                          title={`Revoke the key "${k.name}"?`}
                          description="The server using it stops working right away and its transaction checks will fail. You can make a new key and give it to the server instead."
                          confirmLabel="Revoke"
                          onConfirm={() => revoke(k)}
                        >
                          <Button size="sm" variant="outline">
                            Revoke
                          </Button>
                        </Confirm>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {revokeError ? <p className="mt-2 text-sm text-destructive">{revokeError}</p> : null}
        </section>
      </div>
    </Screen>
  );
}
