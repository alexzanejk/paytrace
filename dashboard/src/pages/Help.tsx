import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { GENUINE, HOW_IT_FITS, ORDER_STATUS, PAGE_INTRO, PAYMENT_STATUS, PAYMENT_TYPE, SAME_THING, type Word } from "@/lib/words";

/** Every word the dashboard uses, explained once, in the same sentences the pages use. For a new team member: read
 *  this page, then the three money pages make sense. */
export function Help() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Help" description="What each page is for and what every word means. Nothing on this page changes anything." />

      <Card className="mb-6 p-5">
        <h3 className="text-base font-semibold">How the three money pages fit together</h3>
        <p className="mt-1 text-sm text-muted-foreground">One payment, three moments. Each page shows one of them.</p>
        <ol className="mt-4 space-y-3">
          {HOW_IT_FITS.map((s, i) => (
            <li key={s.page} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
              <div>
                <p className="font-medium">{s.page} <span className="font-normal text-muted-foreground">— money {s.word}</span></p>
                <p className="text-muted-foreground">{s.says}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          Deposit orders <ArrowRight className="h-3.5 w-3.5" aria-hidden /> Transactions <ArrowRight className="h-3.5 w-3.5" aria-hidden /> Review (only when they do not match).
        </p>
      </Card>

      <Card className="mb-6 p-5">
        <h3 className="text-base font-semibold">The pages</h3>
        <dl className="mt-3 space-y-4">
          {(["overview", "payments", "orders", "review"] as const).map((k) => {
            const p = PAGE_INTRO[k];
            return (
              <div key={k}>
                <dt className="font-medium">{p.title}</dt>
                <dd className="text-sm text-muted-foreground">
                  {p.what}
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {p.lines.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      <Card className="mb-6 p-5">
        <h3 className="text-base font-semibold">The same thing in Admin Hub</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          PayTrace is Admin Hub's payment automation: Admin Hub asks PayTrace whether each TrxID a player submitted really arrived.
          These are the words each side uses for the same thing.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Admin Hub says</th>
                <th className="py-1 pr-3 font-medium">PayTrace says</th>
                <th className="py-1 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {SAME_THING.map((r) => (
                <tr key={r.hub} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-medium">{r.hub}</td>
                  <td className="py-2 pr-3">{r.here}</td>
                  <td className="py-2 text-muted-foreground">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <WordList title="A payment's status" note="On Transactions and Review." words={PAYMENT_STATUS} />
      <WordList title="A deposit order's status" note="On Deposit orders. Waiting / Cancelled are Admin Hub's approval words too." words={ORDER_STATUS} />

      <Card className="mb-6 p-5">
        <h3 className="text-base font-semibold">Kinds of SMS</h3>
        <p className="mt-1 text-sm text-muted-foreground">Which way the money went. All of these are money coming INTO one of your gateway wallets.</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {Object.values(PAYMENT_TYPE).map((t) => (
            <div key={t.label} className="contents">
              <dt className="font-medium">{t.label}</dt>
              <dd className="text-muted-foreground">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <WordList
        title="Looks genuine?"
        note="Shown when you open a row on Transactions. Every real SMS prints the wallet's balance, and real messages form a chain a forger cannot predict."
        words={GENUINE}
      />

      <Card className="p-5">
        <h3 className="text-base font-semibold">Words you may still meet</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="inline font-medium">TrxID</dt><dd className="inline text-muted-foreground"> — the wallet's own receipt number, printed in every SMS. Two payments never share one.</dd></div>
          <div><dt className="inline font-medium">Agent number / personal number</dt><dd className="inline text-muted-foreground"> — an agent number takes customer cash-outs; a personal number takes Send Money.</dd></div>
          <div><dt className="inline font-medium">Phone</dt><dd className="inline text-muted-foreground"> — the Android phone holding the SIM. Each wallet SMS arrives on one phone; the Phones page shows whether each is online.</dd></div>
          <div><dt className="inline font-medium">Website deposit</dt><dd className="inline text-muted-foreground"> — a deposit order one of your sites created when a player pressed Deposit. Most are abandoned, which is why so many are "Expired".</dd></div>
          <div><dt className="inline font-medium">Commission</dt><dd className="inline text-muted-foreground"> — what the wallet pays the agent on a cash-out. Partner commission (the Commission page) is what you pay the person who provides the account.</dd></div>
        </dl>
      </Card>
    </div>
  );
}

function WordList({ title, note, words }: { title: string; note: string; words: Record<string, Word> }) {
  return (
    <Card className="mb-6 p-5">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      <dl className="mt-3 space-y-2">
        {Object.values(words).map((w) => (
          <div key={w.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <dt className="w-44 shrink-0"><Badge tone={w.tone}>{w.label}</Badge></dt>
            <dd className="min-w-0 flex-1 text-muted-foreground">{w.meaning}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
