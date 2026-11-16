import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CopyButton } from "@/components/CopyButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GATEWAY_URL } from "@/lib/apiDocs";
import { PAGE_BRANDS, apiNotes, brandOf, pageHtml, previewHtml, serverNode, serverPhp, type PageProvider } from "@/lib/payTemplates";
import { cn } from "@/lib/utils";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            value === o.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-5">
      <code>{text}</code>
    </pre>
  );
}

/** The bKash, Nagad and Rocket deposit pages as standalone files a website hosts itself (owner 2026-11-17), each with its
 *  own loading animation, plus the server code that fills them and hands the TrxID to the gateway. */
export function PayPageCode() {
  const [provider, setProvider] = useState<PageProvider>("bkash");
  const [method, setMethod] = useState<"cash_out" | "send_money">("cash_out");
  const [server, setServer] = useState<"node" | "php">("node");
  const brand = brandOf(provider);
  const html = useMemo(() => pageHtml(provider), [provider]);
  const preview = useMemo(() => previewHtml(provider, method), [provider, method]);
  const serverCode = server === "node" ? serverNode(GATEWAY_URL) : serverPhp(GATEWAY_URL);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pay page code"
        description="The bKash, Nagad and Rocket deposit pages for websites to host themselves."
        help={
          <p>
            A website that does not want to send customers to PayTrace's own pay page copies these files instead. Its server makes the
            order as usual (create-deposit now also answers with the wallet number), shows one of these pages, and passes the TrxID the
            customer types to the gateway with its own key (the new submit-trx call). The website's API key never goes into the page.
            The customer is still only credited when the payment really arrives, exactly as on PayTrace's own page.
          </p>
        }
      />

      <Card className="p-4">
        <ol className="grid gap-2 text-sm sm:grid-cols-3">
          <li><strong>1. Copy a page.</strong> One file per wallet, with its own loading animation.</li>
          <li><strong>2. Copy the server code.</strong> It fills the page for each order and keeps the key on the server.</li>
          <li><strong>3. Give both to the site's developer</strong> with the site's key from the Sites page.</li>
        </ol>
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Choice label="Wallet" value={provider} onChange={setProvider} options={PAGE_BRANDS.map((b) => ({ id: b.id, label: b.name }))} />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={html} label={`Copy ${brand.name} page`} variant="default" />
            <Button size="sm" variant="outline" onClick={() => download(`${provider}.html`, html)}>
              <Download aria-hidden /> Download {provider}.html
            </Button>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-2">
            <Choice
              label="Way of paying in the preview"
              value={method}
              onChange={setMethod}
              options={[{ id: "cash_out", label: "Cash Out" }, { id: "send_money", label: "Send Money" }]}
            />
            <iframe
              key={`${provider}-${method}`}
              title={`${brand.name} page preview`}
              srcDoc={preview}
              sandbox="allow-scripts"
              className="h-[640px] w-full max-w-[400px] rounded-md border border-border bg-white"
            />
            <p className="text-xs text-muted-foreground">
              Preview with made-up numbers. Type any TrxID (6 or more letters/digits) and press the button to see the loading
              animation ({brand.loader}) and the success screen. It sends nothing.
            </p>
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">{provider}.html</h3>
            <CodeBlock text={html} />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">The website's server</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Choice label="Language" value={server} onChange={setServer} options={[{ id: "node", label: "Node.js" }, { id: "php", label: "PHP" }]} />
            <CopyButton text={serverCode} label="Copy server code" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Opens the page for an order, passes the customer's TrxID to the gateway, and answers the page's "is it paid yet?" check.
        </p>
        <CodeBlock text={serverCode} />
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold">API for the website's server</h3>
          <CopyButton text={apiNotes(GATEWAY_URL)} label="Copy API notes" />
        </div>
        <CodeBlock text={apiNotes(GATEWAY_URL)} />
      </Card>
    </div>
  );
}
