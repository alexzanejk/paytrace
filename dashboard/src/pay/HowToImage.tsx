/** A drawn example of the provider's cash-out confirmation, with the TrxID boxed in red. Our own illustration, not a screenshot. */
export function HowToImage({ lang }: { lang: "bn" | "en" }) {
  return (
    <svg viewBox="0 0 300 410" role="img" aria-label="Example of the confirmation screen with the TrxID marked" className="mx-auto block h-auto w-full max-w-[300px] border border-neutral-300 bg-white">
      <rect width="300" height="22" fill="#b8269c" />
      <text x="24" y="62" fontSize="15" fontWeight="700" fill="#b8269c">{lang === "bn" ? "আপনার ক্যাশ আউট" : "Your Cash Out"}</text>
      <text x="24" y="82" fontSize="15" fontWeight="700" fill="#16a34a">{lang === "bn" ? "সফল হয়েছে" : "was successful"}</text>
      <circle cx="265" cy="62" r="13" fill="none" stroke="#16a34a" strokeWidth="2" />
      <path d="M258 62l5 5 9-10" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="42" cy="118" r="15" fill="#e5e7eb" />
      <rect x="68" y="108" width="90" height="9" rx="3" fill="#d1d5db" />
      <rect x="68" y="124" width="60" height="7" rx="3" fill="#e5e7eb" />
      <line x1="14" y1="152" x2="286" y2="152" stroke="#e5e7eb" />
      <line x1="150" y1="152" x2="150" y2="232" stroke="#e5e7eb" />
      <line x1="14" y1="192" x2="286" y2="192" stroke="#e5e7eb" />
      <line x1="14" y1="232" x2="286" y2="232" stroke="#e5e7eb" />
      <text x="24" y="170" fontSize="9" fill="#6b7280">{lang === "bn" ? "সময়" : "Time"}</text>
      <text x="24" y="184" fontSize="10" fill="#374151">08:42pm 17/09/23</text>
      <text x="160" y="170" fontSize="9" fill="#6b7280">{lang === "bn" ? "ট্রানজেকশন আইডি" : "Transaction ID"}</text>
      <rect x="157" y="174" width="106" height="16" fill="none" stroke="#dc2626" strokeWidth="2" />
      <text x="164" y="186" fontSize="10.5" fontWeight="700" fill="#374151">AIH9GMBRAX</text>
      <text x="24" y="210" fontSize="9" fill="#6b7280">{lang === "bn" ? "সর্বমোট" : "Total"}</text>
      <text x="24" y="224" fontSize="10" fill="#374151">৳1,010.00</text>
      <text x="160" y="210" fontSize="9" fill="#6b7280">{lang === "bn" ? "নতুন ব্যালেন্স" : "New balance"}</text>
      <text x="160" y="224" fontSize="10" fill="#374151">৳967.55</text>
      <circle cx="150" cy="276" r="12" fill="#b8269c" />
      <path d="M150 269l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" fill="#fff" />
      <text x="150" y="312" fontSize="10" textAnchor="middle" fill="#6b7280">{lang === "bn" ? "আপনি অর্জন করেছেন" : "You earned"}</text>
      <text x="150" y="334" fontSize="15" fontWeight="700" textAnchor="middle" fill="#374151">{lang === "bn" ? "বিকাশ রিওয়ার্ড পয়েন্ট" : "bKash reward points"}</text>
    </svg>
  );
}
