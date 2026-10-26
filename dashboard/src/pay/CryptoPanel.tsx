import { useRef, type ReactNode } from "react";
import { Copy, Loader2, ShieldAlert } from "lucide-react";
import type { OrderView } from "./api";
import { clock, type Lang } from "./i18n";

const TEXT = {
  en: {
    title: "Pay with USDT",
    network: "Network",
    warn: "Send only USDT on this network. Any other coin or network will be lost and cannot be returned.",
    amount: "Amount to send",
    exact: "Send exactly this amount, every digit. A different amount cannot be matched to your order automatically.",
    address: "Pay to this address",
    copy: "Copy",
    waiting: "Waiting for your payment",
    auto: "We check the blockchain by ourselves. This page updates the moment your payment arrives, usually within a minute or two.",
    left: "Time left",
    fee: "Network fees are paid by you, on top of this amount.",
    short: "Send exactly",
    s1: "Copy the address",
    s2: "Send the exact amount",
    s3: "We confirm it for you",
    s3b: "This page updates by itself, usually within a minute or two.",
    coin: "Coin",
  },
  bn: {
    title: "USDT দিয়ে পেমেন্ট করুন",
    network: "নেটওয়ার্ক",
    warn: "এই নেটওয়ার্কে শুধু USDT পাঠান। অন্য কয়েন বা অন্য নেটওয়ার্কে পাঠালে টাকা হারিয়ে যাবে, ফেরত পাওয়া যাবে না।",
    amount: "যে পরিমাণ পাঠাবেন",
    exact: "ঠিক এই পরিমাণই পাঠান, প্রতিটি অঙ্ক সহ। অন্য পরিমাণ হলে আপনার অর্ডারের সাথে নিজে থেকে মিলবে না।",
    address: "এই ঠিকানায় পাঠান",
    copy: "কপি",
    waiting: "আপনার পেমেন্টের অপেক্ষায়",
    auto: "আমরা নিজে থেকেই ব্লকচেইন দেখি। পেমেন্ট আসার সাথে সাথে এই পেজ নিজে আপডেট হবে, সাধারণত এক-দুই মিনিটের মধ্যে।",
    left: "বাকি সময়",
    fee: "নেটওয়ার্ক ফি আপনাকেই দিতে হবে, এই পরিমাণের বাইরে।",
    short: "ঠিক এই পরিমাণ পাঠান",
    s1: "ঠিকানাটি কপি করুন",
    s2: "ঠিক পরিমাণ পাঠান",
    s3: "আমরা নিশ্চিত করব",
    s3b: "এই পেজ নিজে আপডেট হবে, সাধারণত এক-দুই মিনিটের মধ্যে।",
    coin: "কয়েন",
  },
} as const;

type T = (typeof TEXT)["en"] | (typeof TEXT)["bn"];

const NETWORK = { bep20: "BNB Smart Chain (BEP20)", trc20: "TRON (TRC20)" } as const;
const COIN = "Tether USDT";
const COLOR = "#0f7b5f";

/** Names for the owner's choice on the Websites page. Number 0 is the original look and stays as it was. */
export const CRYPTO_STYLE_NAMES = ["Classic", "Card", "Steps", "Receipt", "Ring", "Night"] as const;

interface Props {
  view: OrderView;
  lang: Lang;
  left: number;
  style?: number;
  onCopy: (text: string) => void;
}

/** What a customer sees for a USDT deposit: the exact amount, the network, the address. No TrxID is asked: the payment is found on the blockchain.
 *  The page comes in six looks (chosen per website); all show the same facts and ask for nothing. */
export function CryptoPanel({ view, lang, left, style = 0, onCopy }: Props) {
  const total = useRef(0);
  if (left > total.current) total.current = left;
  const c = view.crypto;
  if (!c) return null;
  const t = TEXT[lang];
  const amount = c.amount.toFixed(4);
  const frac = total.current > 0 ? Math.min(1, Math.max(0, left / total.current)) : 0;
  const late = left < 120;
  const common = { t, c, amount, left, frac, late, onCopy };
  switch (style) {
    case 1:
      return <CardLook {...common} />;
    case 2:
      return <StepsLook {...common} />;
    case 3:
      return <ReceiptLook {...common} />;
    case 4:
      return <RingLook {...common} />;
    case 5:
      return <NightLook {...common} />;
    default:
      return <ClassicLook {...common} />;
  }
}

interface LookProps {
  t: T;
  c: NonNullable<OrderView["crypto"]>;
  amount: string;
  left: number;
  frac: number;
  late: boolean;
  onCopy: (text: string) => void;
}

function CopyButton({ text, label, onCopy, dark }: { text: string; label: string; onCopy: (t: string) => void; dark?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(text)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-bold"
      style={dark ? { color: "#5eead4", borderColor: "rgba(94,234,212,.5)" } : { color: COLOR, borderColor: COLOR }}
    >
      <Copy className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function Warn({ t, dark }: { t: T; dark?: boolean }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg p-3 text-[13px] font-semibold leading-5 ${dark ? "bg-amber-400/10 text-amber-200" : "bg-amber-50 text-amber-900"}`}
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t.warn}</span>
    </p>
  );
}

function Time({ t, left, late, dark }: { t: T; left: number; late: boolean; dark?: boolean }) {
  return (
    <span className="text-sm">
      {t.left}: <span className="font-bold tabular-nums" style={{ color: late ? (dark ? "#fca5a5" : "#b3261e") : dark ? "#f1f5f9" : "#222" }}>{clock(left)}</span>
    </span>
  );
}

function Address({ c }: { c: string }) {
  return (
    <span className="break-all font-mono text-[13px] leading-5 min-[360px]:text-sm" data-testid="crypto-address">
      {c}
    </span>
  );
}

/* 0: the original look. */
function ClassicLook({ t, c, amount, left, late, onCopy }: LookProps) {
  const box = "flex items-center justify-between gap-3 rounded bg-neutral-100 px-4 py-3";
  const copyBtn = (text: string) => (
    <button type="button" onClick={() => onCopy(text)} className="shrink-0 rounded border px-3 py-1 text-sm font-bold" style={{ color: COLOR, borderColor: COLOR }}>
      {t.copy}
    </button>
  );
  return (
    <div className="space-y-3 min-[360px]:space-y-4">
      <h1 className="text-lg font-bold min-[360px]:text-xl">{t.title}</h1>
      <div className="rounded px-4 py-3 text-white" style={{ background: COLOR }}>
        <p className="text-xs opacity-90">{t.network}</p>
        <p className="text-lg font-bold">{NETWORK[c.chain]}</p>
      </div>
      <p className="rounded bg-amber-50 p-3 text-[13px] font-bold leading-5 text-amber-900">{t.warn}</p>

      <div>
        <p className="mb-1 text-sm font-bold">{t.amount}</p>
        <div className={box}>
          <span className="text-xl font-bold tabular-nums min-[360px]:text-2xl">{amount} <span className="text-base">USDT</span></span>
          {copyBtn(amount)}
        </div>
        <p className="mt-1 text-xs font-bold text-[#e0392b]">{t.exact}</p>
      </div>

      <div>
        <p className="mb-1 text-sm font-bold">{t.address}</p>
        <div className={box}>
          <span className="break-all font-mono text-[13px] min-[360px]:text-sm" data-testid="crypto-address">{c.address}</span>
          {copyBtn(c.address)}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-neutral-200 p-4 text-center">
        <Loader2 className="mx-auto size-7 animate-spin" style={{ color: COLOR }} />
        <p className="font-bold">{t.waiting}</p>
        <p className="text-xs text-neutral-600">{t.auto}</p>
        <p className="text-sm">
          {t.left}: <span className="font-bold tabular-nums" style={{ color: late ? "#b3261e" : "#222" }}>{clock(left)}</span>
        </p>
      </div>
      <p className="text-xs text-neutral-500">{t.fee}</p>
    </div>
  );
}

/* 1: Card. One big amount, a network chip, the address in a quiet card, a thin time bar. */
function CardLook({ t, c, amount, left, frac, late, onCopy }: LookProps) {
  return (
    <div className="space-y-5 text-center">
      <span className="inline-block rounded-full px-3 py-1 text-xs font-bold" style={{ background: "#e7f4ef", color: COLOR }}>
        {COIN} · {NETWORK[c.chain]}
      </span>
      <div>
        <p className="text-sm text-neutral-500">{t.short}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight min-[360px]:text-[42px]">{amount}</p>
        <p className="text-base font-semibold text-neutral-500">USDT</p>
        <div className="mt-3 flex justify-center">
          <CopyButton text={amount} label={t.copy} onCopy={onCopy} />
        </div>
      </div>
      <div className="rounded-xl border border-neutral-200 p-4 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.address}</p>
        <div className="mt-2">
          <Address c={c.address} />
        </div>
        <div className="mt-3">
          <CopyButton text={c.address} label={t.copy} onCopy={onCopy} />
        </div>
      </div>
      <Warn t={t} />
      <div>
        <div className="h-1 overflow-hidden rounded-full bg-neutral-200" aria-hidden>
          <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%`, background: late ? "#b3261e" : COLOR }} />
        </div>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold">
          <Loader2 className="size-4 animate-spin" style={{ color: COLOR }} aria-hidden />
          {t.waiting} · <Time t={t} left={left} late={late} />
        </p>
      </div>
      <p className="text-xs text-neutral-500">{t.exact}</p>
    </div>
  );
}

/* 2: Steps. Three numbered steps joined by a thin line. */
function StepsLook({ t, c, amount, left, late, onCopy }: LookProps) {
  const dot = (n: number) => (
    <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: COLOR }}>
      {n}
    </span>
  );
  const row = (n: number, title: string, body: ReactNode, last = false) => (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span className="absolute left-3.5 top-7 h-[calc(100%-1.75rem)] w-px bg-neutral-200" aria-hidden />}
      {dot(n)}
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-7">{title}</p>
        {body}
      </div>
    </li>
  );
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold min-[360px]:text-xl">
        {t.title} <span className="text-sm font-semibold text-neutral-500">· {NETWORK[c.chain]}</span>
      </h1>
      <Warn t={t} />
      <ol>
        {row(
          1,
          t.s1,
          <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-neutral-100 px-3 py-2.5">
            <Address c={c.address} />
            <CopyButton text={c.address} label={t.copy} onCopy={onCopy} />
          </div>,
        )}
        {row(
          2,
          t.s2,
          <>
            <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-neutral-100 px-3 py-2.5">
              <span className="text-xl font-bold tabular-nums">{amount} <span className="text-sm">USDT</span></span>
              <CopyButton text={amount} label={t.copy} onCopy={onCopy} />
            </div>
            <p className="mt-1.5 text-xs font-semibold text-[#e0392b]">{t.exact}</p>
          </>,
        )}
        {row(
          3,
          t.s3,
          <>
            <p className="text-xs text-neutral-600">{t.s3b}</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="size-4 animate-spin" style={{ color: COLOR }} aria-hidden />
              {t.waiting} · <Time t={t} left={left} late={late} />
            </p>
          </>,
          true,
        )}
      </ol>
      <p className="text-xs text-neutral-500">{t.fee}</p>
    </div>
  );
}

/* 3: Receipt. A ticket with a dashed edge and label/value rows. */
function ReceiptLook({ t, c, amount, left, late, onCopy }: LookProps) {
  const line = (label: string, value: ReactNode, copy?: string) => (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="flex min-w-0 items-start gap-2 text-right">
        <span className="min-w-0">{value}</span>
        {copy && (
          <button type="button" onClick={() => onCopy(copy)} aria-label={t.copy} className="mt-0.5 shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100">
            <Copy className="size-4" />
          </button>
        )}
      </span>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-dashed border-neutral-300 px-4 py-2">
        <div className="border-b border-dashed border-neutral-300 py-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">{t.title}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{amount} <span className="text-lg">USDT</span></p>
        </div>
        <div className="divide-y divide-dashed divide-neutral-200">
          {line(t.coin, <span className="font-semibold">{COIN} (USDT)</span>)}
          {line(t.network, <span className="font-semibold">{NETWORK[c.chain]}</span>)}
          {line(t.amount, <span className="font-mono font-semibold tabular-nums">{amount}</span>, amount)}
          {line(t.address, <Address c={c.address} />, c.address)}
          {line(t.left, <span className="font-mono font-bold tabular-nums" style={{ color: late ? "#b3261e" : "#222" }}>{clock(left)}</span>)}
        </div>
      </div>
      <Warn t={t} />
      <p className="flex items-center justify-center gap-2 text-sm font-semibold">
        <Loader2 className="size-4 animate-spin" style={{ color: COLOR }} aria-hidden />
        {t.waiting}
      </p>
      <p className="text-center text-xs text-neutral-500">{t.exact}</p>
    </div>
  );
}

/* 4: Ring. The time left is a thin ring around the amount. */
function RingLook({ t, c, amount, left, frac, late, onCopy }: LookProps) {
  const r = 78;
  const len = 2 * Math.PI * r;
  return (
    <div className="space-y-5 text-center">
      <div className="relative mx-auto size-[190px]">
        <svg viewBox="0 0 190 190" className="size-full -rotate-90" aria-hidden>
          <circle cx="95" cy="95" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
          <circle
            cx="95"
            cy="95"
            r={r}
            fill="none"
            stroke={late ? "#b3261e" : COLOR}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={len}
            strokeDashoffset={len * (1 - frac)}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{NETWORK[c.chain]}</p>
          <p className="text-[28px] font-bold leading-9 tabular-nums">{amount}</p>
          <p className="text-sm font-bold tabular-nums" style={{ color: late ? "#b3261e" : COLOR }}>{clock(left)}</p>
        </div>
      </div>
      <div className="flex justify-center">
        <CopyButton text={amount} label={`${t.copy} ${amount}`} onCopy={onCopy} />
      </div>
      <div className="border-y border-neutral-200 py-3 text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.address}</p>
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <Address c={c.address} />
          <button type="button" onClick={() => onCopy(c.address)} aria-label={t.copy} className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-100">
            <Copy className="size-4" />
          </button>
        </div>
      </div>
      <Warn t={t} />
      <p className="flex items-center justify-center gap-2 text-sm font-semibold">
        <Loader2 className="size-4 animate-spin" style={{ color: COLOR }} aria-hidden />
        {t.waiting}
      </p>
      <p className="text-xs text-neutral-500">{t.exact}</p>
    </div>
  );
}

/* 5: Night. A dark panel with a soft teal accent. */
function NightLook({ t, c, amount, left, late, onCopy }: LookProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-5 rounded-2xl bg-[#0f1720] p-5 text-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-300">{t.title}</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-teal-300">{NETWORK[c.chain]}</span>
        </div>
        <div>
          <p className="text-xs text-slate-400">{t.amount}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-[34px] font-bold leading-10 tabular-nums">{amount} <span className="text-base font-semibold text-slate-400">USDT</span></p>
            <CopyButton text={amount} label={t.copy} onCopy={onCopy} dark />
          </div>
          <p className="mt-2 text-xs font-medium text-rose-300">{t.exact}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">{t.address}</p>
          <div className="mt-1.5 flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3 text-slate-100">
            <Address c={c.address} />
            <CopyButton text={c.address} label={t.copy} onCopy={onCopy} dark />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-4 text-slate-300">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="size-4 animate-spin text-teal-300" aria-hidden />
            {t.waiting}
          </span>
          <Time t={t} left={left} late={late} dark />
        </div>
      </div>
      <Warn t={t} />
      <p className="text-xs text-neutral-500">{t.fee}</p>
    </div>
  );
}
