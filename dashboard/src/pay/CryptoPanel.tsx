import { Loader2 } from "lucide-react";
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
  },
} as const;

const NETWORK = { bep20: "BNB Smart Chain (BEP20)", trc20: "TRON (TRC20)" } as const;
const COLOR = "#0f7b5f";

/** What a customer sees for a USDT deposit: the exact amount, the network, the address. No TrxID is asked: the payment is found on the blockchain. */
export function CryptoPanel({ view, lang, left, onCopy }: { view: OrderView; lang: Lang; left: number; onCopy: (text: string) => void }) {
  const c = view.crypto;
  if (!c) return null;
  const t = TEXT[lang];
  const amount = c.amount.toFixed(4);
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
          {t.left}: <span className="font-bold tabular-nums" style={{ color: left < 120 ? "#b3261e" : "#222" }}>{clock(left)}</span>
        </p>
      </div>
      <p className="text-xs text-neutral-500">{t.fee}</p>
    </div>
  );
}
