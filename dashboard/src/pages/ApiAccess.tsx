import { useState, type FormEvent } from "react";
import { BookOpen, ChevronDown, ExternalLink, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { must, sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { depositInstructions, developerInstructions, VERIFY_URL } from "@/lib/apiDocs";
import { useQuery } from "@/hooks/useQuery";
import { Screen } from "@/components/Screen";
import { PageHeader } from "@/components/PageHeader";
import { CopyButton } from "@/components/CopyButton";
import { SiteCard, type SiteKey } from "@/components/SiteCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NewKey {
  id: string;
  name: string;
  key: string;
}

const DOCS_URL = `${window.location.origin}/docs/`;

/** Websites that use PayTrace: add one, set where its results go, and send its developer the guide. */
export function ApiAccess() {
  const { data, error, loading, refresh } = useQuery(
    async () =>
      must(
        await sb
          .from("api_keys")
          .select("id,name,key_prefix,created_at,last_used_at,revoked_at,webhook_url,result_style,crypto_style,redirect_success_url,redirect_failed_url")
          .order("created_at", { ascending: false }),
      ) as SiteKey[],
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

  async function revoke(k: SiteKey) {
    setRevokeError("");
    const { error: err } = await sb.rpc("revoke_api_key", { p_id: k.id });
    if (err) return setRevokeError(err.message);
    if (fresh?.id === k.id) setFresh(null);
    refresh();
  }

  const all = data ?? [];
  const active = all.filter((k) => !k.revoked_at);
  const revoked = all.filter((k) => k.revoked_at);

  return (
    <Screen loading={loading} error={error} hasData={!!data}>
      <div className="grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-6">
        <PageHeader
          title="Websites"
          description="Each website that uses PayTrace gets its own key. Add the website, choose where it receives payment results, then send its developer the guide."
        />

        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            ["Add the website", "Give it a name and make its key."],
            ["Set it up", "Say where it gets “paid” messages, how its result page looks and where customers go afterwards."],
            ["Send the developer", "The guide link, the key and the secret. That is all they need."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-lg border border-border p-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
              <span>
                <span className="block font-medium">{t}</span>
                <span className="text-xs text-muted-foreground">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        {fresh ? (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" aria-hidden />
                Key for "{fresh.name}"
              </CardTitle>
              <CardDescription className="flex items-start gap-1.5 text-status-warn">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Copy it now. This is the only time it is shown; PayTrace keeps only a scrambled version and cannot show it again. If you lose it, revoke it and add the website again.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <code className="break-all rounded-lg border border-border bg-muted px-3 py-2 text-sm" data-testid="new-key">
                {fresh.key}
              </code>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={fresh.key} label="Copy key" variant="default" />
                <CopyButton text={() => depositInstructions(fresh.key)} label="Copy developer brief with this key" />
                <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
                  I have saved it
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Whoever holds this key can create deposits in your name. Send it only to the developer, store it in the server's settings, and never put it in a web page or app.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden /> Add a website
            </CardTitle>
            <CardDescription>Use the website's name, for example "Main shop" or "Game top-up".</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="flex flex-wrap items-end gap-3">
              <div className="grid min-w-56 flex-1 gap-1">
                <Label htmlFor="key-name">Website name</Label>
                <Input id="key-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Main shop" />
              </div>
              <Button type="submit" disabled={busy || name.trim().length === 0}>
                {busy ? "Adding…" : "Add website and make key"}
              </Button>
            </form>
            {problem ? <p className="mt-2 text-sm text-destructive">{problem}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" aria-hidden /> Guide for the developer
            </CardTitle>
            <CardDescription>
              A public page that explains every step with code in Node.js, PHP and Python. It contains no secrets, so you can send the link to anyone building a website.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs">{DOCS_URL}</code>
              <CopyButton text={DOCS_URL} label="Copy link" variant="default" />
              <a href="/docs/" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink className="h-4 w-4" aria-hidden /> Open
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href="/pay/?demo=1" target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Preview the customer pay page
              </a>
              <span className="text-xs text-muted-foreground">Pretend data; nothing real is created or paid.</span>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-3">
          <h3 className="text-base font-semibold">Your websites</h3>
          {active.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">No website yet. Add one above.</Card>
          ) : (
            active.map((k) => <SiteCard key={k.id} site={k} onChanged={refresh} onRevoke={() => void revoke(k)} />)
          )}
          {revokeError ? <p className="text-sm text-destructive">{revokeError}</p> : null}
          <p className="text-xs text-muted-foreground">
            Customers are sent to the deposit numbers you set on the <a className="underline" href="#/devices">Phones</a> tab. Add at least one number there before a website goes live.
          </p>
        </section>

        {revoked.length > 0 ? (
          <details className="rounded-lg border border-border p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <ChevronDown className="h-4 w-4" aria-hidden /> Revoked websites ({revoked.length})
            </summary>
            <ul className="mt-3 grid gap-2 text-sm">
              {revoked.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                  <span>{k.name} <span className="font-mono text-xs">{k.key_prefix}…</span></span>
                  <span className="flex items-center gap-2 text-xs"><Badge tone="idle">Revoked</Badge>{k.revoked_at ? when(k.revoked_at) : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="rounded-lg border border-border p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <ChevronDown className="h-4 w-4" aria-hidden /> Optional: let a website check a transaction ID
          </summary>
          <div className="mt-3 grid gap-3">
            <p className="text-sm text-muted-foreground">
              Separate from deposits. A website's server can ask whether a transaction ID a customer typed really arrived, and for how much. It uses the same website keys as above.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs">{VERIFY_URL}</code>
              <CopyButton text={VERIFY_URL} label="Copy address" />
              <CopyButton text={() => developerInstructions()} label="Copy instructions" />
            </div>
          </div>
        </details>
      </div>
    </Screen>
  );
}
