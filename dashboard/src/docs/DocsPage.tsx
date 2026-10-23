import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { CREATE, CREATE_RESPONSE, GATEWAY, LANG_LABEL, STATUS, VERIFY, WEBHOOK_BODY, type Lang } from "./samples";

/** Public integration guide for partner websites that add PayTrace deposits. No login; it contains no secrets. */

const SECTIONS = [
  ["overview", "How it works"],
  ["start", "Before you start"],
  ["create", "1. Create a deposit"],
  ["redirect", "2. Send the customer to PayTrace"],
  ["webhook", "3. Receive the result"],
  ["status", "4. Check an order (optional)"],
  ["statuses", "Order statuses"],
  ["errors", "Errors"],
  ["test", "Testing and going live"],
  ["faq", "Questions"],
] as const;

function Code({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1800);
    } catch {
      /* the text is selectable; copying is a convenience */
    }
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => void copy()} className="absolute right-2 top-2 flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20" aria-label="Copy code">
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-[#10151c] p-4 pr-20 text-[13px] leading-relaxed text-[#e6edf3]">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function Tabs({ samples, langs }: { samples: Partial<Record<Lang, string>>; langs: Lang[] }) {
  const [lang, setLang] = useState<Lang>(langs[0]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Language">
        {langs.map((l) => (
          <button key={l} type="button" role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className={`rounded-md px-3 py-1 text-sm font-medium ${lang === l ? "bg-[#1f6f50] text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>
      <Code text={samples[lang] ?? ""} />
    </div>
  );
}

function Note({ tone = "info", title, children }: { tone?: "info" | "warn" | "key"; title: string; children: ReactNode }) {
  const c = tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950" : tone === "key" ? "border-red-300 bg-red-50 text-red-950" : "border-blue-200 bg-blue-50 text-blue-950";
  return (
    <div className={`rounded-lg border p-4 text-sm ${c}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 space-y-1">{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4 border-t border-neutral-200 pt-8">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-100 align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "whitespace-nowrap font-mono text-[13px]" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const M = ({ children }: { children: ReactNode }) => <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;

function Flow() {
  const steps: [string, string, string][] = [
    ["Your site", "Customer picks a method on YOUR page, for example “Nagad Cash Out”.", "#334155"],
    ["Your server", "Calls PayTrace: create a deposit. Gets a pay link.", "#1f6f50"],
    ["PayTrace page", "Customer sees the number to pay, pays, and enters the TrxID.", "#b8269c"],
    ["PayTrace", "Matches the TrxID with the real payment message on the phone.", "#ee7621"],
    ["Your server", "Gets a signed “paid” message. Credits the customer once.", "#1f6f50"],
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-5">
      {steps.map(([who, what, color], i) => (
        <li key={i} className="rounded-lg border border-neutral-200 p-3 text-sm">
          <span className="mb-2 inline-grid size-6 place-items-center rounded-full text-xs font-bold text-white" style={{ background: color }}>{i + 1}</span>
          <p className="font-semibold">{who}</p>
          <p className="mt-1 text-neutral-600">{what}</p>
        </li>
      ))}
    </ol>
  );
}

export function DocsPage() {
  return (
    <div className="min-h-screen bg-white text-[#1b1f23]" style={{ fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif' }}>
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <p className="font-bold">PayTrace <span className="font-normal text-neutral-500">Deposit Gateway: Integration Guide</span></p>
          <a href="#create" className="rounded-md bg-[#1f6f50] px-3 py-1.5 text-sm font-semibold text-white">Quick start</a>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Contents" className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="block rounded px-2 py-1 text-neutral-600 hover:bg-neutral-100 hover:text-black">{label}</a></li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 space-y-10">
          <div className="space-y-3">
            <h1 className="text-3xl font-extrabold tracking-tight">Accept deposits with PayTrace</h1>
            <p className="max-w-2xl text-lg text-neutral-600">
              Your customer pays a bKash, Nagad or Rocket number, enters the transaction ID (TrxID), and PayTrace confirms it against the real payment and tells your server.
              You build four small things: one call to create a deposit, a redirect, a webhook receiver, and (optionally) a status check.
            </p>
          </div>

          <Section id="overview" title="How it works">
            <Flow />
            <p className="text-neutral-700">
              <strong>Your site</strong> shows the deposit methods and lets the customer choose (for example “bKash Send Money” or “Nagad Cash Out”). PayTrace&apos;s page starts after that choice, at the payment and TrxID step, so you do not build it.
              Money is never credited because a customer clicked something: you credit only when PayTrace tells your server the order is <M>paid</M>.
            </p>
          </Section>

          <Section id="start" title="Before you start">
            <p className="text-neutral-700">Ask the PayTrace owner for these. They make them on the dashboard&apos;s <em>Websites</em> page, one set per website.</p>
            <Table
              head={["You need", "What it is", "Where it goes"]}
              rows={[
                ["API key", <>Starts with <M>ptk_</M>. Identifies your site.</>, "Server settings only. Never in a web page, app or repository."],
                ["Webhook address", "An https address on YOUR server that receives “paid” messages. You give it to the owner.", "Your server code."],
                ["Webhook secret", <>Starts with <M>whsec_</M>. Lets you check a message really came from PayTrace.</>, "Server settings only."],
              ]}
            />
            <Note tone="key" title="Keep keys on your server">
              Anyone holding your API key can create orders in your name. Call PayTrace only from your server. If a key leaks, ask the owner to revoke it and make a new one.
            </Note>
          </Section>

          <Section id="create" title="1. Create a deposit">
            <p className="text-neutral-700">When the customer has chosen a method and an amount, your server asks PayTrace for a deposit.</p>
            <p><span className="rounded bg-[#1f6f50] px-2 py-0.5 text-xs font-bold text-white">POST</span> <code className="ml-2 break-all font-mono text-sm">{GATEWAY}/create-deposit</code></p>
            <Table
              head={["Header", "Value"]}
              rows={[["Authorization", <>Bearer YOUR_API_KEY</>], ["Content-Type", "application/json"]]}
            />
            <Table
              head={["Field", "Required", "What it is"]}
              rows={[
                ["amount", "yes", "Number from 10 to 500000, up to 2 decimals. In taka (BDT). The customer must pay exactly this."],
                ["order_id", "yes", "YOUR own order number (up to 100 characters). Sending the same order_id again returns the same deposit, so retrying is safe."],
                ["provider", "yes", <><M>bkash</M>, <M>nagad</M>, <M>rocket</M> or <M>upay</M>: the method the customer chose on your page.</>],
                ["method", "no", <><M>send_money</M> or <M>cash_out</M>. Use it when you offer both for one provider (for example Nagad Send Money and Nagad Cash Out). Leave it out to accept either.</>],
                ["return_url", "no", "https address. After a confirmed payment the customer is sent back here. Do not credit based on this visit; use the webhook."],
                ["expires_in_minutes", "no", "3 to 60. Default 15. How long the customer has to pay."],
                ["customer_name, customer_phone", "no", "For your own records."],
              ]}
            />
            <Tabs samples={CREATE} langs={["curl", "node", "php", "python"]} />
            <p className="text-sm font-semibold">Successful answer (HTTP 200)</p>
            <Code text={CREATE_RESPONSE} />
            <Note title="Save the order">
              Store <M>order_id</M> (yours) and <M>tracking_number</M> (PayTrace&apos;s) with your pending deposit so you can match the webhook later.
            </Note>
          </Section>

          <Section id="redirect" title="2. Send the customer to PayTrace">
            <p className="text-neutral-700">
              Redirect the customer&apos;s browser to <M>pay_url</M>. PayTrace shows the number to pay and a countdown, the customer pays in their wallet app, then pastes the TrxID and presses Confirm.
              PayTrace shows a waiting screen and then the result, in Bangla or English, and sends the customer to your <M>return_url</M> after a confirmed payment.
            </p>
            <Note tone="warn" title="Do not trust the browser">
              A customer can open your <M>return_url</M> without paying. Credit the customer only when your server has received a verified <M>deposit.paid</M> webhook (or <M>order-status</M> says <M>paid</M>).
            </Note>
          </Section>

          <Section id="webhook" title="3. Receive the result">
            <p className="text-neutral-700">
              PayTrace sends a <M>POST</M> with JSON to your webhook address whenever an order is paid, held for review, expired or cancelled.
            </p>
            <Table
              head={["Event", "Meaning", "What to do"]}
              rows={[
                ["deposit.paid", "The payment was found and matches the amount.", "Credit the customer, once."],
                ["deposit.review", "A person at PayTrace is checking it (for example the amount differed).", "Do nothing yet. You will get deposit.paid if it is approved."],
                ["deposit.expired", "Time ran out without a confirmed payment.", "Mark the deposit as expired. The customer can start again."],
                ["deposit.cancelled", "The order was cancelled.", "Mark it cancelled."],
              ]}
            />
            <Code text={WEBHOOK_BODY} />
            <p className="text-sm font-semibold">Check the signature on every message</p>
            <p className="text-neutral-700">
              Each request has a header <M>X-PayTrace-Signature: t=1700000000,v1=abc123…</M>. Compute HMAC-SHA256 with your webhook secret over the text <M>{"<t>.<raw request body>"}</M>, compare it with <M>v1</M> in constant time, and reject messages where <M>t</M> is more than 5 minutes old.
              Use the raw body exactly as received.
            </p>
            <Tabs samples={VERIFY} langs={["node", "php", "python"]} />
            <Note title="Answer quickly with a 2xx">
              Reply <M>200</M> as soon as you have stored the message. Anything else (or no answer within 8 seconds) is retried after 1 minute, 5 minutes, 15 minutes, 1 hour, 3 hours, 6 hours and 12 hours, then PayTrace gives up, so use the status check (step 4) to catch up on anything you missed.
              The same event can arrive more than once, so credit by <M>order_id</M> only if you have not already credited it.
            </Note>
          </Section>

          <Section id="status" title="4. Check an order (optional)">
            <p className="text-neutral-700">Use this as a safety net, for example if a webhook did not arrive, or to show “still waiting” in your own account page.</p>
            <p><span className="rounded bg-[#1f6f50] px-2 py-0.5 text-xs font-bold text-white">POST</span> <code className="ml-2 break-all font-mono text-sm">{GATEWAY}/order-status</code></p>
            <p className="text-neutral-700">Send <M>{'{ "order_id": "SHOP-1001" }'}</M> or <M>{'{ "tracking_number": "…" }'}</M>. Same <M>Authorization</M> header. You can only see your own orders.</p>
            <Tabs samples={STATUS} langs={["curl", "node", "php", "python"]} />
            <p className="text-sm text-neutral-600">Limit: 120 requests per minute per key.</p>
          </Section>

          <Section id="statuses" title="Order statuses">
            <Table
              head={["status", "Meaning"]}
              rows={[
                ["pending", "Created. Waiting for the customer to pay and enter the TrxID, or for the payment message to arrive."],
                ["paid", "Confirmed. This is the only status you credit on."],
                ["review", "Held for a manual check (wrong amount, late payment, or unusual). Not credited. Wait for paid."],
                ["expired", "Time ran out."],
                ["cancelled", "Cancelled by the PayTrace owner."],
              ]}
            />
          </Section>

          <Section id="errors" title="Errors">
            <Table
              head={["HTTP", "error", "What to do"]}
              rows={[
                ["400", "see the message", "Fix the request (a missing or invalid field)."],
                ["401", "unauthorized", "The API key is wrong or was revoked. Ask the owner for a new one."],
                ["409", "no_wallet", "No deposit number is set up for that provider or method. Hide that method on your page and tell the owner."],
                ["404", "order not found", "That order_id or tracking_number is not yours or does not exist."],
                ["429", "too many requests", "Wait a minute and retry (limit 120 per minute per key)."],
                ["5xx or timeout", "", "Try again. Using the same order_id makes the retry safe."],
              ]}
            />
          </Section>

          <Section id="test" title="Testing and going live">
            <ol className="list-decimal space-y-2 pl-5 text-neutral-700">
              <li>Ask the owner for a key and webhook secret, and for a small test amount (for example 10 taka).</li>
              <li>Create a deposit from your server and open the <M>pay_url</M> on your phone.</li>
              <li>Pay the number shown with a real transfer, then enter the TrxID.</li>
              <li>Confirm your server received a verified <M>deposit.paid</M> and credited the test customer exactly once.</li>
              <li>Test an expired order (create one and let it run out) and a repeat of the same <M>order_id</M>.</li>
            </ol>
            <Note tone="warn" title="Go-live checklist">
              <ul className="list-disc space-y-1 pl-5">
                <li>The API key and webhook secret are in server settings, not in code or the browser.</li>
                <li>You verify the signature and reject old timestamps.</li>
                <li>You credit only on <M>deposit.paid</M>, once per <M>order_id</M>, and check the amount.</li>
                <li>Your webhook answers 200 quickly and handles repeats.</li>
                <li>You handle 409 <M>no_wallet</M> by hiding or disabling that method.</li>
              </ul>
            </Note>
          </Section>

          <Section id="faq" title="Questions">
            <dl className="space-y-4 text-neutral-700">
              <div><dt className="font-semibold">Can the customer change the amount?</dt><dd>No. They must pay exactly the amount you sent. A different amount is held for review and not credited.</dd></div>
              <div><dt className="font-semibold">What if the customer pays but never enters the TrxID?</dt><dd>The order expires and you get <M>deposit.expired</M>. The owner can match the payment by hand; you would then receive <M>deposit.paid</M>.</dd></div>
              <div><dt className="font-semibold">What if the customer enters a TrxID twice or someone else&apos;s?</dt><dd>A TrxID can pay one order only, and only if it arrived on the number shown to that customer. Otherwise the order is held for review or refused.</dd></div>
              <div><dt className="font-semibold">Does the page look the same on every site?</dt><dd>The payment and TrxID page is the same for everyone. The screen after Confirm has several looks; the owner picks one per site.</dd></div>
              <div><dt className="font-semibold">Which currency?</dt><dd>Bangladeshi taka (BDT) only.</dd></div>
            </dl>
          </Section>

          <footer className="border-t border-neutral-200 pt-6 text-sm text-neutral-500">
            PayTrace Deposit Gateway. This guide has no secrets in it. Questions about your keys or deposit numbers go to the PayTrace owner.
          </footer>
        </main>
      </div>
    </div>
  );
}
