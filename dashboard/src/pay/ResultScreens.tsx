import { AlertTriangle, Check, Clock, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Lang } from "./i18n";

/** The screens a customer sees after pressing Confirm on the transaction-submission page: waiting for the payment to be
 *  confirmed, paid, held for a manual check, or expired. There are six looks, so two sites using PayTrace do not show an
 *  identical result page. Which look a site gets is set per API key (or automatic). The submission page itself is the same for all. */
export type Phase = "checking" | "paid" | "review" | "expired";

export interface ResultProps {
  style: number;
  phase: Phase;
  lang: Lang;
  amount: string;
  shop: string;
  provider: string;
  trx: string;
  returnUrl: string | null;
  onChange: () => void;
}

export const RESULT_STYLE_NAMES = ["Aurora (dark pulse)", "Steps", "Receipt", "Checklist", "Ring", "Playful"] as const;

type Copy = Record<Phase, [string, string]>;
const COPY: Record<number, Record<Lang, Copy>> = {
  0: {
    bn: { checking: ["আপনার পেমেন্ট নিশ্চিত করা হচ্ছে", "অনুগ্রহ করে অপেক্ষা করুন। এই পেজটি নিজে থেকেই আপডেট হবে।"], paid: ["পেমেন্ট সম্পন্ন", "আপনার টাকা সফলভাবে জমা হয়েছে।"], review: ["যাচাই চলছে", "আপনার পেমেন্টটি একজন ব্যক্তি দেখছেন। আবার পেমেন্ট করবেন না।"], expired: ["সময় শেষ", "এই পেমেন্টের সময় শেষ হয়ে গেছে। দোকানে ফিরে নতুন করে শুরু করুন।"] },
    en: { checking: ["Confirming your payment", "Please hold on. This page updates by itself."], paid: ["Payment complete", "Your money has been credited."], review: ["Under review", "A person is looking at your payment. Please do not pay again."], expired: ["Time is up", "This payment has expired. Go back to the shop and start again."] },
  },
  1: {
    bn: { checking: ["ধাপে ধাপে যাচাই চলছে", "আপনার TrxID জমা হয়েছে। এখন পেমেন্টের সাথে মেলানো হচ্ছে।"], paid: ["সব ধাপ সম্পন্ন", "আপনার পেমেন্ট নিশ্চিত হয়েছে।"], review: ["দ্বিতীয় ধাপে থেমে আছে", "পরিমাণ বা তথ্য মেলেনি, তাই হাতে দেখা হচ্ছে।"], expired: ["সময় পেরিয়ে গেছে", "যাচাই শেষ হওয়ার আগেই সময় শেষ। দোকানে ফিরে আবার চেষ্টা করুন।"] },
    en: { checking: ["Checking, step by step", "Your TrxID is in. Now matching it with the payment."], paid: ["All steps complete", "Your payment is confirmed."], review: ["Paused at step two", "The amount or details did not match, so it is being checked by hand."], expired: ["Time ran out", "The time ended before the check finished. Go back to the shop and try again."] },
  },
  2: {
    bn: { checking: ["লেনদেন মিলিয়ে দেখা হচ্ছে", "আপনার রসিদটি যাচাই করা হচ্ছে।"], paid: ["পেমেন্ট গৃহীত", "ধন্যবাদ, রসিদটি সংরক্ষণ করুন।"], review: ["রসিদ আটকে আছে", "হাতে যাচাই শেষ হলে জানানো হবে।"], expired: ["রসিদের মেয়াদ শেষ", "দোকানে ফিরে নতুন পেমেন্ট শুরু করুন।"] },
    en: { checking: ["Matching your transaction", "Your receipt is being verified."], paid: ["Payment accepted", "Thank you. Keep this receipt."], review: ["Receipt on hold", "We will tell the shop when the manual check is done."], expired: ["Receipt expired", "Go back to the shop and start a new payment."] },
  },
  3: {
    bn: { checking: ["যাচাই চলছে…", "প্রতিটি পরীক্ষা শেষ হলে টিক পড়বে।"], paid: ["সব পরীক্ষা পাস", "পেমেন্ট নিশ্চিত।"], review: ["একটি পরীক্ষা আটকে গেছে", "হাতে দেখা হচ্ছে। অপেক্ষা করুন।"], expired: ["সময় শেষ", "পরীক্ষা শেষ হয়নি। আবার শুরু করুন।"] },
    en: { checking: ["Running checks…", "Each check gets a tick when it passes."], paid: ["All checks passed", "Payment confirmed."], review: ["One check is stuck", "It is being looked at by hand. Please wait."], expired: ["Time is up", "The checks did not finish. Please start again."] },
  },
  4: {
    bn: { checking: ["যাচাই করা হচ্ছে", "কয়েক মুহূর্ত লাগতে পারে।"], paid: ["ধন্যবাদ!", "আপনার পেমেন্ট পাওয়া গেছে।"], review: ["একটু অপেক্ষা", "আপনার পেমেন্ট দেখা হচ্ছে।"], expired: ["মেয়াদ শেষ", "নতুন করে শুরু করুন।"] },
    en: { checking: ["Verifying", "This can take a few moments."], paid: ["Thank you!", "Your payment has arrived."], review: ["One moment", "Your payment is being looked at."], expired: ["Expired", "Please start again."] },
  },
  5: {
    bn: { checking: ["প্রায় হয়ে গেছে…", "আমরা আপনার পেমেন্টটি খুঁজে দেখছি, একটু ধৈর্য ধরুন!"], paid: ["দারুণ! পেমেন্ট হয়ে গেছে", "আপনার টাকা জমা হয়েছে। ধন্যবাদ!"], review: ["একটু সময় লাগছে", "চিন্তা নেই, আপনার পেমেন্ট নিরাপদ। আমরা দেখছি।"], expired: ["ইস, সময় শেষ!", "কোনো সমস্যা নেই, দোকানে ফিরে আবার চেষ্টা করুন।"] },
    en: { checking: ["Almost there…", "We are looking for your payment. Hang tight!"], paid: ["All done! Payment received", "Your money is in. Thank you!"], review: ["This is taking a moment", "No worries, your payment is safe. We are on it."], expired: ["Oh no, time is up!", "No problem. Go back to the shop and try again."] },
  },
};

const LABELS: Record<Lang, Record<string, string>> = {
  bn: { amount: "পরিমাণ", via: "মাধ্যম", trx: "TrxID", shop: "দোকান", status: "অবস্থা", change: "TrxID বদলান", back: "এখনই ফিরে যান", returning: "আপনাকে ফেরত নেওয়া হচ্ছে…", s1: "জমা হয়েছে", s2: "যাচাই", s3: "নিশ্চিত", c1: "TrxID পাওয়া গেছে", c2: "পরিমাণ মেলানো", c3: "ওয়ালেট নিশ্চিত", receipt: "পেমেন্ট রসিদ", paid: "পরিশোধিত", hold: "অপেক্ষমাণ", exp: "মেয়াদ শেষ", st_checking: "যাচাই হচ্ছে", st_paid: "নিশ্চিত", st_review: "যাচাইয়ে", st_expired: "মেয়াদ শেষ" },
  en: { amount: "Amount", via: "Via", trx: "TrxID", shop: "Shop", status: "Status", change: "Change TrxID", back: "Go back now", returning: "Taking you back…", s1: "Submitted", s2: "Verifying", s3: "Confirmed", c1: "TrxID received", c2: "Matching the amount", c3: "Confirming the wallet", receipt: "Payment receipt", paid: "PAID", hold: "ON HOLD", exp: "EXPIRED", st_checking: "Verifying", st_paid: "Confirmed", st_review: "In review", st_expired: "Expired" },
};

const CONFETTI = ["#f97316", "#22c55e", "#3b82f6", "#eab308", "#ec4899", "#8b5cf6"];

function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <span
          key={i}
          className="r-fall absolute block h-2.5 w-2 rounded-[2px]"
          style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 6) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function Tick({ size = 40, stroke = "#fff", width = 3.5 }: { size?: number; stroke?: string; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
      <path className="r-draw" d="M5 12.5l4.5 4.5L19 7.5" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Footer({ p, dark = false }: { p: ResultProps; dark?: boolean }) {
  const L = LABELS[p.lang];
  const muted = dark ? "text-white/70" : "text-neutral-500";
  return (
    <div className="mt-5 space-y-2 text-center text-sm">
      {p.phase === "paid" && p.returnUrl && (
        <p className={muted}>
          {L.returning}{" "}
          <a className="font-semibold underline" href={p.returnUrl} rel="noreferrer noopener">
            {L.back}
          </a>
        </p>
      )}
      {p.phase === "checking" && (
        <button type="button" onClick={p.onChange} className={`text-sm font-semibold underline ${dark ? "text-white/80" : "text-neutral-700"}`}>
          {L.change}
        </button>
      )}
    </div>
  );
}

const tone = (phase: Phase) => (phase === "paid" ? "#16a34a" : phase === "review" ? "#d97706" : phase === "expired" ? "#dc2626" : "#2563eb");

function PhaseIcon({ phase, size = 32 }: { phase: Phase; size?: number }) {
  if (phase === "paid") return <Check className="text-white" style={{ width: size, height: size }} strokeWidth={3.5} />;
  if (phase === "review") return <AlertTriangle className="text-white" style={{ width: size, height: size }} />;
  if (phase === "expired") return <Clock className="text-white" style={{ width: size, height: size }} />;
  return <Loader2 className="r-spin text-white" style={{ width: size, height: size }} />;
}

// ---------- 0: Aurora, a dark card with pulsing rings ----------
function Aurora(p: ResultProps) {
  const [title, body] = COPY[0][p.lang][p.phase];
  const L = LABELS[p.lang];
  const c = tone(p.phase);
  return (
    <section className="relative overflow-hidden rounded-3xl px-6 py-10 text-center text-white" style={{ background: "linear-gradient(160deg,#0b1020,#1e1b4b 55%,#0f3d3a)" }}>
      <div className="relative mx-auto mb-7 grid size-28 place-items-center">
        {p.phase === "checking" && [0, 0.6, 1.2].map((d) => <span key={d} className="r-ping absolute inset-0 rounded-full border-2" style={{ borderColor: c, animationDelay: `${d}s` }} />)}
        <span className={`relative grid size-20 place-items-center rounded-full ${p.phase === "paid" ? "r-pop" : ""}`} style={{ background: c, boxShadow: `0 0 40px ${c}88` }}>
          {p.phase === "paid" ? <Tick /> : <PhaseIcon phase={p.phase} />}
        </span>
      </div>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-white/75">{body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
        <span className="rounded-full bg-white/10 px-3 py-1">{p.amount}</span>
        <span className="rounded-full bg-white/10 px-3 py-1">{p.provider}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 font-mono">{p.trx}</span>
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-widest text-white/50">{L.status}: {L[`st_${p.phase}`]}</p>
      <Footer p={p} dark />
    </section>
  );
}

// ---------- 1: Steps ----------
function Steps(p: ResultProps) {
  const [title, body] = COPY[1][p.lang][p.phase];
  const L = LABELS[p.lang];
  const stepState = (i: number): "done" | "active" | "idle" | "bad" | "hold" => {
    if (p.phase === "paid") return "done";
    if (i === 0) return "done";
    if (i === 1) return p.phase === "checking" ? "active" : p.phase === "review" ? "hold" : "bad";
    return "idle";
  };
  const labels = [L.s1, L.s2, L.s3];
  return (
    <section className="rounded-lg border border-neutral-200 bg-white px-5 py-8">
      <ol className="mx-auto flex max-w-md items-start">
        {labels.map((label, i) => {
          const st = stepState(i);
          const bg = st === "done" ? "#16a34a" : st === "active" ? "#2563eb" : st === "hold" ? "#d97706" : st === "bad" ? "#dc2626" : "#d4d4d8";
          return (
            <li key={label} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span className={`h-1 flex-1 ${i === 0 ? "opacity-0" : ""}`} style={{ background: stepState(i - 1 < 0 ? 0 : i - 1) === "done" && st !== "idle" ? "#16a34a" : "#e4e4e7" }} />
                <span className={`grid size-9 place-items-center rounded-full text-white ${st === "done" ? "r-pop" : ""}`} style={{ background: bg, animationDelay: `${i * 0.18}s` }}>
                  {st === "done" ? <Check className="size-5" strokeWidth={3.5} /> : st === "active" ? <Loader2 className="r-spin size-5" /> : st === "hold" ? <AlertTriangle className="size-5" /> : st === "bad" ? <X className="size-5" /> : i + 1}
                </span>
                <span className={`h-1 flex-1 ${i === 2 ? "opacity-0" : ""}`} style={{ background: "#e4e4e7" }} />
              </div>
              <span className="mt-2 text-xs font-semibold text-neutral-600">{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 h-1.5 overflow-hidden rounded bg-neutral-100">{p.phase === "checking" && <div className="r-bar h-full w-1/3 rounded bg-blue-600" />}</div>
      <h2 className="mt-6 text-center text-xl font-bold">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-center text-sm text-neutral-600">{body}</p>
      <dl className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-y-1 text-sm">
        <dt className="text-neutral-500">{L.amount}</dt><dd className="text-right font-semibold">{p.amount}</dd>
        <dt className="text-neutral-500">{L.trx}</dt><dd className="text-right font-mono">{p.trx}</dd>
      </dl>
      <Footer p={p} />
    </section>
  );
}

// ---------- 2: Receipt ----------
function Receipt(p: ResultProps) {
  const [title, body] = COPY[2][p.lang][p.phase];
  const L = LABELS[p.lang];
  const stamp = p.phase === "paid" ? { t: L.paid, c: "#16a34a" } : p.phase === "review" ? { t: L.hold, c: "#d97706" } : p.phase === "expired" ? { t: L.exp, c: "#dc2626" } : null;
  return (
    <section className="relative mx-auto max-w-md overflow-hidden bg-[#fffdf6] px-6 py-7 shadow-md" style={{ border: "1px dashed #c9c2a8", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-neutral-700">{L.receipt}</p>
      <div className="my-3 border-t border-dashed border-neutral-400" />
      <dl className="space-y-2 text-sm">
        {[[L.shop, p.shop], [L.via, p.provider], [L.amount, p.amount]].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-neutral-500">{k}</dt><dd className="font-semibold">{v}</dd></div>
        ))}
        <div className="relative flex justify-between gap-4 overflow-hidden py-1">
          <dt className="text-neutral-500">{L.trx}</dt>
          <dd className="font-semibold">{p.trx}</dd>
          {p.phase === "checking" && <span className="r-scan bg-blue-600/70" />}
        </div>
      </dl>
      <div className="my-3 border-t border-dashed border-neutral-400" />
      <h2 className="text-center text-base font-bold">{title}</h2>
      <p className="mt-1 text-center text-xs text-neutral-600">{body}</p>
      {stamp && (
        <span className="r-stamp pointer-events-none absolute bottom-16 right-4 rounded border-4 px-3 py-1 text-xl font-extrabold tracking-widest" style={{ color: stamp.c, borderColor: stamp.c }}>
          {stamp.t}
        </span>
      )}
      <Footer p={p} />
    </section>
  );
}

// ---------- 3: Checklist ----------
function Checklist(p: ResultProps) {
  const [title, body] = COPY[3][p.lang][p.phase];
  const L = LABELS[p.lang];
  const rows: [string, "done" | "wait" | "bad" | "hold"][] = [
    [L.c1, "done"],
    [L.c2, p.phase === "paid" ? "done" : p.phase === "review" ? "hold" : p.phase === "expired" ? "bad" : "wait"],
    [L.c3, p.phase === "paid" ? "done" : p.phase === "expired" ? "bad" : "wait"],
  ];
  return (
    <section className="rounded-md border border-neutral-300 bg-neutral-50 px-5 py-6" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-xs text-neutral-600">{body}</p>
      <ul className="mt-5 space-y-3">
        {rows.map(([label, st], i) => (
          <li key={label} className="r-rise flex items-center gap-3 text-sm" style={{ animationDelay: `${i * 0.2}s` }}>
            <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: st === "done" ? "#16a34a" : st === "hold" ? "#d97706" : st === "bad" ? "#dc2626" : "#94a3b8" }}>
              {st === "done" ? <Check className="size-4" strokeWidth={3.5} /> : st === "hold" ? <AlertTriangle className="size-3.5" /> : st === "bad" ? <X className="size-4" /> : <Loader2 className="r-spin size-4" />}
            </span>
            <span className={st === "wait" ? "r-blink" : ""}>{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-neutral-500">
        {p.amount} · {p.provider} · <span className="font-semibold">{p.trx}</span>
      </p>
      <Footer p={p} />
    </section>
  );
}

// ---------- 4: Ring ----------
function Ring(p: ResultProps) {
  const [title, body] = COPY[4][p.lang][p.phase];
  const c = tone(p.phase);
  return (
    <section className="rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-1 ring-neutral-200">
      <div className="relative mx-auto grid size-36 place-items-center">
        <svg viewBox="0 0 100 100" className={`absolute inset-0 ${p.phase === "checking" ? "r-spin-slow" : ""}`} aria-hidden>
          <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="6" />
          {p.phase === "checking" ? (
            <circle cx="50" cy="50" r="45" fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" strokeDasharray="70 213" />
          ) : (
            <circle className="r-fill" cx="50" cy="50" r="45" fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" transform="rotate(-90 50 50)" />
          )}
        </svg>
        <span className="relative grid place-items-center">
          {p.phase === "paid" ? <Tick size={56} stroke={c} width={3} /> : p.phase === "review" ? <AlertTriangle className="size-10" style={{ color: c }} /> : p.phase === "expired" ? <Clock className="size-10" style={{ color: c }} /> : <span className="text-2xl font-bold tabular-nums" style={{ color: c }}>{p.amount.replace("BDT ", "৳")}</span>}
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-xs text-sm text-neutral-600">{body}</p>
      <p className="mt-4 font-mono text-xs text-neutral-500">{p.trx}</p>
      <Footer p={p} />
    </section>
  );
}

// ---------- 5: Playful ----------
function Playful(p: ResultProps) {
  const [title, body] = COPY[5][p.lang][p.phase];
  const L = LABELS[p.lang];
  const c = tone(p.phase);
  return (
    <section className="relative overflow-hidden rounded-[28px] px-6 py-10 text-center" style={{ background: "#fff4d6" }}>
      {p.phase === "paid" && <Confetti />}
      {p.phase === "checking" ? (
        <div className="mx-auto mb-6 flex h-12 items-end justify-center gap-2" aria-hidden>
          {["#f97316", "#22c55e", "#3b82f6"].map((col, i) => (
            <span key={col} className="r-bounce block size-4 rounded-full" style={{ background: col, animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      ) : (
        <span className="r-pop mx-auto mb-5 grid size-20 place-items-center rounded-[26px]" style={{ background: c, transform: "rotate(-6deg)" }}>
          {p.phase === "paid" ? <Tick /> : <PhaseIcon phase={p.phase} size={36} />}
        </span>
      )}
      <h2 className="text-2xl font-extrabold text-neutral-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-700">{body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-white px-3 py-1">{p.amount}</span>
        <span className="rounded-full bg-white px-3 py-1">{L[`st_${p.phase}`]}</span>
        <span className="rounded-full bg-white px-3 py-1 font-mono">{p.trx}</span>
      </div>
      <Footer p={p} />
    </section>
  );
}

const VIEWS = [Aurora, Steps, Receipt, Checklist, Ring, Playful];

/** The whole result screen for a look. The page wraps it in a frame, so the header's amount and shop stay in place. */
export function ResultScreen(p: ResultProps): ReactNode {
  const V = VIEWS[((p.style % VIEWS.length) + VIEWS.length) % VIEWS.length];
  return <V {...p} />;
}
