import { Banknote, CirclePlus, HandCoins, Lightbulb, PiggyBank, Send, ShoppingBag, Smartphone, type LucideIcon } from "lucide-react";
import type { Lang } from "./i18n";

/** What the "how do I find the TrxID" popup shows. One per provider and way of paying, as on the owner's reference pages. All the
 *  pictures are drawn here (not screenshots of any provider's app). */
export type HowKind = "bkash_cash" | "nagad_cash" | "rocket_cash" | "bkash_send";

export function howKind(provider: string, method: string | null): HowKind {
  if (method === "send_money" && provider === "bkash") return "bkash_send";
  if (provider === "nagad") return "nagad_cash";
  if (provider === "rocket") return "rocket_cash";
  return "bkash_cash";
}

const RED = "#dc2626";

function BkashCashImage({ lang }: { lang: Lang }) {
  const bn = lang === "bn";
  return (
    <svg viewBox="0 0 300 410" role="img" aria-label="Example of the confirmation screen with the TrxID marked" className="mx-auto block h-auto w-full max-w-[300px] border border-neutral-300 bg-white">
      <rect width="300" height="22" fill="#b8269c" />
      <text x="24" y="62" fontSize="15" fontWeight="700" fill="#b8269c">{bn ? "আপনার ক্যাশ আউট" : "Your Cash Out"}</text>
      <text x="24" y="82" fontSize="15" fontWeight="700" fill="#16a34a">{bn ? "সফল হয়েছে" : "was successful"}</text>
      <circle cx="265" cy="62" r="13" fill="none" stroke="#16a34a" strokeWidth="2" />
      <path d="M258 62l5 5 9-10" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="42" cy="118" r="15" fill="#e5e7eb" />
      <rect x="68" y="108" width="90" height="9" rx="3" fill="#d1d5db" />
      <rect x="68" y="124" width="60" height="7" rx="3" fill="#e5e7eb" />
      <line x1="14" y1="152" x2="286" y2="152" stroke="#e5e7eb" />
      <line x1="150" y1="152" x2="150" y2="232" stroke="#e5e7eb" />
      <line x1="14" y1="192" x2="286" y2="192" stroke="#e5e7eb" />
      <line x1="14" y1="232" x2="286" y2="232" stroke="#e5e7eb" />
      <text x="24" y="170" fontSize="9" fill="#6b7280">{bn ? "সময়" : "Time"}</text>
      <text x="24" y="184" fontSize="10" fill="#374151">08:42pm 17/09/23</text>
      <text x="160" y="170" fontSize="9" fill="#6b7280">{bn ? "ট্রানজেকশন আইডি" : "Transaction ID"}</text>
      <rect x="157" y="174" width="106" height="16" fill="none" stroke={RED} strokeWidth="2" />
      <text x="164" y="186" fontSize="10.5" fontWeight="700" fill="#374151">AIH9GMBRAX</text>
      <text x="24" y="210" fontSize="9" fill="#6b7280">{bn ? "সর্বমোট" : "Total"}</text>
      <text x="24" y="224" fontSize="10" fill="#374151">৳1,010.00</text>
      <text x="160" y="210" fontSize="9" fill="#6b7280">{bn ? "নতুন ব্যালেন্স" : "New balance"}</text>
      <text x="160" y="224" fontSize="10" fill="#374151">৳967.55</text>
      <circle cx="150" cy="276" r="12" fill="#b8269c" />
      <path d="M150 269l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" fill="#fff" />
      <text x="150" y="312" fontSize="10" textAnchor="middle" fill="#6b7280">{bn ? "আপনি অর্জন করেছেন" : "You earned"}</text>
      <text x="150" y="334" fontSize="15" fontWeight="700" textAnchor="middle" fill="#374151">{bn ? "বিকাশ রিওয়ার্ড পয়েন্ট" : "bKash reward points"}</text>
    </svg>
  );
}

function NagadCashImage({ lang }: { lang: Lang }) {
  const bn = lang === "bn";
  const rows: [string, string, string][] = [
    [bn ? "ট্রানজেকশন আইডি" : "Transaction ID", "726NPKXU", "id"],
    [bn ? "পরিমাণ" : "Amount", "180.00 Tk", ""],
    [bn ? "ফি" : "Fee", "1.24 Tk", ""],
    [bn ? "ভ্যাট" : "VAT", "0.19 Tk", ""],
    [bn ? "সর্বমোট খরচ**" : "Total charges**", "1.38 Tk", ""],
    [bn ? "সর্বমোট" : "Total", "181.58 Tk", ""],
    [bn ? "সময়" : "Time", "16 Sep 2023, 07:53 PM", ""],
  ];
  return (
    <svg viewBox="0 0 300 330" role="img" aria-label="Example of the Nagad Cash Out confirmation with the transaction ID marked" className="mx-auto block h-auto w-full max-w-[300px] bg-white">
      <line x1="0" y1="2" x2="300" y2="2" stroke="#0b6b45" strokeWidth="2" />
      <circle cx="150" cy="44" r="24" fill="none" stroke="#c9a227" strokeWidth="3" />
      <path d="M138 44l9 9 16-18" fill="none" stroke="#0b6b45" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <text x="150" y="94" fontSize="14" fontWeight="700" textAnchor="middle" fill="#0b6b45">{bn ? "ক্যাশ আউট সফল" : "Cash Out successful"}</text>
      <rect x="100" y="104" width="100" height="8" rx="3" fill="#e5e7eb" />
      <rect x="115" y="118" width="70" height="7" rx="3" fill="#eee" />
      {rows.map(([label, value, id], i) => {
        const y = 150 + i * 20;
        return (
          <g key={label}>
            <text x="14" y={y} fontSize="9.5" fontWeight="700" fill="#2e7d32">{label}</text>
            {id ? (
              <>
                <rect x="196" y={y - 13} width="90" height="19" fill="none" stroke={RED} strokeWidth="2.2" />
                <text x="241" y={y} fontSize="11" fontWeight="700" textAnchor="middle" fill="#374151">{value}</text>
              </>
            ) : (
              <text x="286" y={y} fontSize="9.5" textAnchor="end" fill="#6b7280">{value}</text>
            )}
          </g>
        );
      })}
      <line x1="14" y1="300" x2="286" y2="300" stroke="#e5e7eb" />
      <text x="90" y="318" fontSize="9" fill="#6b7280">{bn ? "কল" : "Call"}</text>
      <text x="200" y="318" fontSize="9" fill="#6b7280">{bn ? "মেসেজ" : "Message"}</text>
    </svg>
  );
}

function RocketCashImage() {
  return (
    <svg viewBox="0 0 300 330" role="img" aria-label="Example of the Rocket Cash Out message with the TxnId marked" className="mx-auto block h-auto w-full max-w-[300px] bg-white">
      <rect width="300" height="330" fill="#5f5f66" />
      <rect width="300" height="40" fill="#5b1470" />
      <path d="M22 20h14M22 20l6-6M22 20l6 6" stroke="#e9d5f0" strokeWidth="2" fill="none" strokeLinecap="round" />
      <text x="48" y="25" fontSize="14" fill="#e9d5f0">Confirm Cash Out</text>
      <circle cx="150" cy="82" r="22" fill="#3d3d42" />
      <text x="26" y="136" fontSize="10" fill="#9b8aa6">Account No.</text>
      <text x="170" y="132" fontSize="10" fill="#9b8aa6">Recipient Name</text>
      <text x="170" y="148" fontSize="11" fontWeight="700" fill="#d6d6d6">Unknown</text>
      <rect x="22" y="164" width="256" height="136" fill="#fff" />
      <rect x="22" y="164" width="256" height="30" fill="#8e1f9e" />
      <circle cx="40" cy="179" r="6.5" fill="#fff" />
      <text x="40" y="182.5" fontSize="9" fontWeight="700" textAnchor="middle" fill="#8e1f9e">i</text>
      <text x="56" y="183" fontSize="12" fill="#fff">Info</text>
      <text x="32" y="214" fontSize="10.5" fill="#374151">Cash Out from A/C ***730 Success.</text>
      <text x="32" y="230" fontSize="10.5" fill="#374151">TxnId:</text>
      <rect x="64" y="219" width="72" height="15" fill="none" stroke={RED} strokeWidth="1.6" />
      <text x="68" y="230" fontSize="10.5" fill="#374151">5508654578</text>
      <text x="139" y="230" fontSize="10.5" fill="#374151">TxnAmount:</text>
      <text x="32" y="246" fontSize="10.5" fill="#374151">Tk500.00.Please download https://bit.ly</text>
      <text x="32" y="262" fontSize="10.5" fill="#374151">/nexuspay</text>
      <text x="200" y="288" fontSize="10" fill="#8e1f9e">OK</text>
      <text x="228" y="288" fontSize="10" fill="#8e1f9e">RECEIPT</text>
    </svg>
  );
}

const TILES: { icon: LucideIcon; bn: string; en: string; tint: string }[] = [
  { icon: Send, bn: "সেন্ড মানি", en: "Send Money", tint: "#e2136e" },
  { icon: Smartphone, bn: "মোবাইল রিচার্জ", en: "Mobile Recharge", tint: "#2e9a5b" },
  { icon: Banknote, bn: "ক্যাশ আউট", en: "Cash Out", tint: "#1b9aa6" },
  { icon: ShoppingBag, bn: "পেমেন্ট", en: "Payment", tint: "#d99a4e" },
  { icon: CirclePlus, bn: "অ্যাড মানি", en: "Add Money", tint: "#7a5bd6" },
  { icon: Lightbulb, bn: "পে বিল", en: "Pay Bill", tint: "#8aa0b8" },
  { icon: PiggyBank, bn: "সেভিংস", en: "Savings", tint: "#e0559a" },
  { icon: HandCoins, bn: "লোন", en: "Loan", tint: "#a36b3f" },
];

/** The row of four menu tiles shown on the page itself for bKash Send Money, with "Send Money" selected. */
export function BkashMenuRow({ lang }: { lang: Lang }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
      {TILES.slice(0, 4).map((tl, i) => (
        <div key={tl.en} className="flex flex-col items-center gap-1">
          <span className="grid size-[54px] place-items-center rounded-md" style={{ border: i === 0 ? `2px solid ${RED}` : "1px solid transparent", color: tl.tint }}>
            <tl.icon className="size-8" strokeWidth={1.6} aria-hidden />
          </span>
          <span className="text-neutral-700">{lang === "bn" ? tl.bn : tl.en}</span>
        </div>
      ))}
    </div>
  );
}

function BkashSendSteps({ lang }: { lang: Lang }) {
  const bn = lang === "bn";
  return (
    <div className="space-y-3 text-left text-[13px] text-neutral-700">
      <div className="flex gap-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-neutral-400 text-[11px]">1</span>
        <p>{bn ? "অ্যাকাউন্ট নম্বর কপি করুন এবং 'সেন্ড মানি' ব্যবহার করে পেমেন্ট করতে বিকাশ-এ যান।" : "Copy the account number and go to bKash to pay with 'Send Money'."}</p>
      </div>
      <div className="grid grid-cols-4 gap-x-1 gap-y-3 rounded-md border-t-4 border-[#e2136e] px-1 py-3 text-center text-[10px]">
        {TILES.map((tl, i) => (
          <div key={tl.en} className="flex flex-col items-center gap-1">
            <span className="grid size-[44px] place-items-center rounded-md" style={{ border: i === 0 ? `2px solid ${RED}` : "1px solid transparent", color: tl.tint }}>
              <tl.icon className="size-7" strokeWidth={1.6} aria-hidden />
            </span>
            <span>{bn ? tl.bn : tl.en}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-neutral-400 text-[11px]">2</span>
        <p>{bn ? "বিকাশের TrxID কপি করুন এবং এই পৃষ্ঠায় ফিরে প্রবেশ করুন।" : "Copy the bKash TrxID and come back to this page to enter it."}</p>
      </div>
      <svg viewBox="0 0 290 150" role="img" aria-label="Example showing where the TrxID is copied from" className="block h-auto w-full bg-neutral-50">
        <rect x="14" y="10" width="92" height="132" rx="8" fill="#fff" stroke="#d1d5db" />
        <rect x="14" y="10" width="92" height="22" rx="8" fill="#e2136e" />
        <rect x="24" y="44" width="72" height="8" rx="3" fill="#e5e7eb" />
        <rect x="24" y="60" width="72" height="14" rx="4" fill="#fff" stroke={RED} strokeWidth="1.5" />
        <rect x="24" y="84" width="50" height="7" rx="3" fill="#e5e7eb" />
        <rect x="24" y="98" width="62" height="7" rx="3" fill="#e5e7eb" />
        <path d="M100 66C130 22 190 18 236 62" fill="none" stroke={RED} strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M236 62l-9-1 5-8z" fill={RED} />
        <rect x="130" y="82" width="140" height="34" rx="17" fill="#fff" stroke="#d1d5db" />
        <text x="146" y="96" fontSize="8" fill="#6b7280">TrxID</text>
        <text x="146" y="109" fontSize="11" fontWeight="700" fill="#374151">CFM0000000</text>
        <rect x="244" y="94" width="10" height="12" rx="2" fill="none" stroke="#e2136e" />
        <text x="200" y="134" fontSize="8" textAnchor="middle" fill="#6b7280">{bn ? "*কপি করার জন্য কপি বোতামে ক্লিক করুন" : "*Tap the copy button to copy"}</text>
      </svg>
    </div>
  );
}

export const howTitle = (kind: HowKind, lang: Lang) =>
  kind === "bkash_send" ? (lang === "bn" ? "শুধু ২টি ধাপে, পেমেন্ট সম্পন্ন করুন।" : "Complete the payment in just 2 steps.") : "How to complete a cash transaction?";
export const howCaption = (kind: HowKind) => (kind === "bkash_send" ? "" : "Please copy and fill out this label after completing the transfer.");
export const howClose = (kind: HowKind, lang: Lang) => (kind === "bkash_send" ? (lang === "bn" ? "বন্ধ" : "Close") : "Close");

export function HowToBody({ kind, lang }: { kind: HowKind; lang: Lang }) {
  if (kind === "bkash_send") return <BkashSendSteps lang={lang} />;
  if (kind === "nagad_cash") return <NagadCashImage lang={lang} />;
  if (kind === "rocket_cash") return <RocketCashImage />;
  return <BkashCashImage lang={lang} />;
}
