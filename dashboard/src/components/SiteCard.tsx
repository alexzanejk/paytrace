import { useState } from "react";
import { Eye, EyeOff, Globe, KeyRound } from "lucide-react";
import { sb } from "@/lib/supabase";
import { when } from "@/lib/format";
import { depositInstructions } from "@/lib/apiDocs";
import { RESULT_STYLE_NAMES } from "@/pay/ResultScreens";
import { Confirm } from "@/components/Confirm";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SiteKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  webhook_url: string | null;
  result_style: number | null;
  redirect_success_url: string | null;
  redirect_failed_url: string | null;
}

const AUTO = "auto";

/** The site's key and signing secret: hidden as dots until the eye is pressed; Copy works either way. Asked for from the database each time, never kept in the browser. */
function KeyReveal({ siteId, hasSecret }: { siteId: string; hasSecret: boolean }) {
  const [shown, setShown] = useState(false);
  const [vals, setVals] = useState<{ key: string | null; webhook_secret: string | null } | null>(null);
  const [problem, setProblem] = useState("");

  async function load(): Promise<{ key: string | null; webhook_secret: string | null } | null> {
    if (vals) return vals;
    const { data, error } = await sb.rpc("reveal_api_key", { p_id: siteId });
    if (error) {
      setProblem(error.message);
      return null;
    }
    setProblem("");
    const v = data as { key: string | null; webhook_secret: string | null };
    setVals(v);
    return v;
  }

  async function toggle() {
    if (!shown) await load();
    setShown((v) => !v);
  }

  const row = (label: string, value: string | null | undefined, field: "key" | "webhook_secret") => (
    <div key={field} className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-muted px-3 py-1.5 text-xs" data-testid={`reveal-${field}`}>
        {shown && value ? value : "•".repeat(24)}
      </code>
      <CopyButton
        text={async () => (await load())?.[field] ?? ""}
        label="Copy"
      />
    </div>
  );

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Key for this website</h4>
        <Button size="sm" variant="outline" onClick={() => void toggle()} aria-pressed={shown}>
          {shown ? <EyeOff className="mr-1 h-4 w-4" aria-hidden /> : <Eye className="mr-1 h-4 w-4" aria-hidden />}
          {shown ? "Hide" : "Show"}
        </Button>
      </div>
      {vals && vals.key === null ? (
        <p className="text-xs text-status-warn">
          This key was made before keys could be shown again, so it cannot be displayed. Make a new key for this website (Add a website), give its developer the new one, then revoke this one.
        </p>
      ) : (
        <>
          {row("API key", vals?.key, "key")}
          {hasSecret ? row("Signing secret", vals?.webhook_secret, "webhook_secret") : null}
        </>
      )}
      {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
      <p className="text-xs text-muted-foreground">Anyone with the key can create deposits as this website. Share it only with its developer.</p>
    </section>
  );
}

/** One website that uses PayTrace: its key, where its payment results go, how its result page looks, and what to send its developer. */
export function SiteCard({ site, onChanged, onRevoke }: { site: SiteKey; onChanged: () => void; onRevoke: () => void }) {
  const [url, setUrl] = useState("");
  const [hookBusy, setHookBusy] = useState(false);
  const [hookNote, setHookNote] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [lookNote, setLookNote] = useState("");
  const [okUrl, setOkUrl] = useState<string | null>(null);
  const [badUrl, setBadUrl] = useState<string | null>(null);
  const [goNote, setGoNote] = useState("");
  const okValue = okUrl ?? site.redirect_success_url ?? "";
  const badValue = badUrl ?? site.redirect_failed_url ?? "";
  const lookValue = look ?? (site.result_style === null ? AUTO : String(site.result_style));

  async function saveHook(clear: boolean) {
    setHookBusy(true);
    setHookNote("");
    const { data, error } = await sb.rpc("set_key_webhook", { p_id: site.id, p_url: clear ? "" : url });
    setHookBusy(false);
    if (error) return setHookNote(error.message);
    const made = (data as { secret?: string | null } | null)?.secret;
    if (made) setSecret(made);
    setUrl("");
    setHookNote(clear ? "Turned off." : "Saved.");
    onChanged();
  }

  async function saveGo() {
    setGoNote("");
    const { error } = await sb.rpc("set_key_redirects", { p_id: site.id, p_success: okValue, p_failed: badValue });
    if (error) return setGoNote(error.message);
    setGoNote("Saved.");
    setOkUrl(null);
    setBadUrl(null);
    onChanged();
  }

  async function saveLook() {
    setLookNote("");
    const { error } = await sb.rpc("set_key_result_style", { p_id: site.id, p_style: lookValue === AUTO ? null : Number(lookValue) });
    if (error) return setLookNote(error.message);
    setLookNote("Saved.");
    setLook(null);
    onChanged();
  }

  return (
    <Card className="grid gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Globe className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{site.name}</span>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" aria-hidden /> key starts <span className="font-mono">{site.key_prefix}…</span></span>
            <span>made {when(site.created_at)}</span>
            <span>{site.last_used_at ? `last used ${when(site.last_used_at)}` : "never used yet"}</span>
          </p>
        </div>
        <Badge tone="ok">Active</Badge>
      </div>

      <KeyReveal siteId={site.id} hasSecret={!!site.webhook_url} />

      <section className="grid gap-2">
        <h4 className="text-sm font-semibold">1. Where should PayTrace tell this site that a deposit was paid?</h4>
        <p className="text-xs text-muted-foreground">
          Your developer gives you an https address on the website's server. PayTrace sends a signed message there when a deposit is paid, held or expired.
          Without it the site can still ask for the result, but it is slower.
        </p>
        <p className="text-sm">
          {site.webhook_url ? (
            <>Now sending to <code className="break-all text-xs">{site.webhook_url}</code></>
          ) : (
            <span className="text-status-warn">Not set yet</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-56 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourshop.com/paytrace-webhook" aria-label={`Result address for ${site.name}`} />
          <Button size="sm" onClick={() => void saveHook(false)} disabled={hookBusy || !url.trim()}>{hookBusy ? "Saving…" : site.webhook_url ? "Change address" : "Save address"}</Button>
          {site.webhook_url ? (
            <Button size="sm" variant="ghost" onClick={() => void saveHook(true)} disabled={hookBusy}>Turn off</Button>
          ) : null}
        </div>
        {hookNote ? <p className="text-xs text-muted-foreground">{hookNote}</p> : null}
        {secret ? (
          <div className="grid gap-2 rounded-lg border border-primary p-3">
            <p className="text-sm font-medium">Signing secret (shown once)</p>
            <code className="break-all rounded-lg border border-border bg-muted px-3 py-2 text-sm" data-testid="hook-secret">{secret}</code>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={secret} label="Copy secret" variant="default" />
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>I have saved it</Button>
            </div>
            <p className="text-xs text-muted-foreground">Give this to the developer. It lets the site check a message really came from PayTrace. It cannot be shown again; changing the address keeps the same secret.</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-2">
        <h4 className="text-sm font-semibold">2. How should this site's result page look?</h4>
        <p className="text-xs text-muted-foreground">
          After a customer presses Confirm they see a waiting screen, then paid, held or expired. Automatic gives this site its own look that never changes. The payment and TrxID page is the same for every site.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <Select value={lookValue} onValueChange={(v) => { setLook(v); setLookNote(""); }}>
              <SelectTrigger aria-label={`Result page look for ${site.name}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Automatic</SelectItem>
                {RESULT_STYLE_NAMES.map((n, i) => (
                  <SelectItem key={n} value={String(i)}>{i + 1}. {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={() => void saveLook()} disabled={look === null}>Save look</Button>
          <a href={`/pay/?demo=1&style=${lookValue === AUTO ? 0 : lookValue}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>Preview</a>
          {lookNote ? <span className="text-xs text-muted-foreground">{lookNote}</span> : null}
        </div>
      </section>

      <section className="grid gap-2">
        <h4 className="text-sm font-semibold">3. Where should the customer go afterwards?</h4>
        <p className="text-xs text-muted-foreground">
          A few seconds after the result the customer is sent back to this website, to the page you choose here, for example their account, deposit history or home page.
          The customer only ever sees the website's own addresses. A deposit that sends its own "return_url" uses that one instead.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium">
            After a paid deposit
            <Input value={okValue} onChange={(e) => { setOkUrl(e.target.value); setGoNote(""); }} placeholder="https://yourshop.com/account/deposits" aria-label={`Page after a paid deposit for ${site.name}`} />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            After an expired or cancelled deposit
            <Input value={badValue} onChange={(e) => { setBadUrl(e.target.value); setGoNote(""); }} placeholder="https://yourshop.com/deposit" aria-label={`Page after a failed deposit for ${site.name}`} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void saveGo()} disabled={okUrl === null && badUrl === null}>Save pages</Button>
          {goNote ? <span className="text-xs text-muted-foreground">{goNote}</span> : null}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={() => depositInstructions()} label="Copy developer brief" />
          <span className="text-xs text-muted-foreground">Plain text for the developer. It does not contain the key.</span>
        </div>
        <Confirm
          title={`Revoke the key for "${site.name}"?`}
          description="This website stops working right away: it can no longer create deposits or ask for results. You can add the website again with a new key."
          confirmLabel="Revoke"
          onConfirm={onRevoke}
        >
          <Button size="sm" variant="outline">Revoke key</Button>
        </Confirm>
      </section>
    </Card>
  );
}
