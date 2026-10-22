// Wording for the customer's pay page, in Bangla and English. Plain text only: nothing here is ever rendered as HTML.
// Two layouts exist, as on the gateway pages the owner showed: "cash" (customer cashes out at the agent number) and
// "send" (customer sends money). Each has its own wording; the dialogs and toasts the reference page shows in English
// stay in English in both languages.
export type Lang = "bn" | "en";
export type Variant = "cash" | "send";

export const PROVIDER_NAME: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };

/** Banner colour per provider and way of paying (from the owner's recordings). */
export function bannerColor(provider: string, variant: Variant): string {
  if (provider === "bkash") return "#b8269c";
  if (provider === "rocket") return "#7b2d8e";
  if (provider === "upay") return "#0b6cb5";
  return variant === "send" ? "#ee7621" : "#e8472b"; // nagad
}
export const HEADER_GREEN = "#216a4a";
/** The header is green for Cash Out pages and takes the provider's colour on Send Money pages. */
export const headerColor = (provider: string, variant: Variant) => (variant === "send" ? bannerColor(provider, variant) : HEADER_GREEN);

type Dict = Record<string, string>;

const common: Record<Lang, Dict> = {
  bn: {
    expiresIn: "পেমেন্ট বৈধ",
    walletNo: "Wallet No",
    walletNoSend: "ওয়ালেট নম্বর",
    walletProvider: "ওয়ালেট প্রদানকারী",
    deposit: "Deposit",
    copy: "কপি",
    checkingTitle: "আপনার পেমেন্ট যাচাই করা হচ্ছে",
    checkingBody: "সাধারণত এক মিনিটের কম সময় লাগে। পেজটি খোলা রাখুন, এটি নিজে থেকেই আপডেট হবে।",
    yourTrx: "আপনার TrxID",
    change: "TrxID বদলান",
    paidTitle: "পেমেন্ট পাওয়া গেছে",
    paidBody: "ধন্যবাদ। আপনার {amount} পেমেন্ট নিশ্চিত হয়েছে।",
    returning: "আপনাকে {shop}-এ ফেরত নেওয়া হচ্ছে…",
    returnNow: "এখনই ফিরে যান",
    reviewTitle: "আপনার পেমেন্ট পর্যালোচনা করা হচ্ছে",
    reviewBody: "আপনার পেমেন্ট পাওয়া গেছে, তবে একটু যাচাই দরকার (যেমন পরিমাণ আলাদা)। অপেক্ষা করুন বা {shop}-এর সাথে যোগাযোগ করুন। আবার পেমেন্ট করবেন না।",
    expiredTitle: "এই পেমেন্টের সময় শেষ",
    expiredBody: "অনুগ্রহ করে {shop}-এ ফিরে নতুন পেমেন্ট শুরু করুন। আপনি যদি আগেই পেমেন্ট করে থাকেন, TrxID সহ দোকানের সাথে যোগাযোগ করুন।",
    notFoundTitle: "পেমেন্ট পাওয়া যায়নি",
    notFoundBody: "এই লিংকটি সঠিক নয়। অনুগ্রহ করে দোকান থেকে আবার শুরু করুন।",
    closedTitle: "এই পেমেন্ট বন্ধ হয়ে গেছে",
    used: "এই TrxID আগেই অন্য পেমেন্টে ব্যবহার হয়েছে।",
    tooMany: "অনেকবার চেষ্টা করা হয়েছে। দোকানের সাথে যোগাযোগ করুন।",
    wrongMethod: "এই রসিদটি এই পেমেন্টের জন্য প্রযোজ্য ধরনের নয়। উপরে দেখানো পদ্ধতিতে পেমেন্ট করুন।",
    invalid: "TrxID ফরম্যাট সঠিক নয়",
    failed: "সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।",
    noWallet: "এখন কোনো পেমেন্ট নম্বর পাওয়া যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন বা দোকানের সাথে যোগাযোগ করুন।",
    badLink: "এই লিংকে পেমেন্ট পদ্ধতি নেই। অনুগ্রহ করে দোকান থেকে আবার শুরু করুন।",
    retry: "আবার চেষ্টা করুন",
    loading: "লোড হচ্ছে…",
  },
  en: {
    expiresIn: "Payment valid",
    walletNo: "Wallet No",
    walletNoSend: "Wallet number",
    walletProvider: "Wallet provider",
    deposit: "Deposit",
    copy: "Copy",
    checkingTitle: "We are checking your payment",
    checkingBody: "This usually takes under a minute. Keep this page open; it updates by itself.",
    yourTrx: "Your TrxID",
    change: "Change TrxID",
    paidTitle: "Payment received",
    paidBody: "Thank you. Your payment of {amount} was confirmed.",
    returning: "Taking you back to {shop}…",
    returnNow: "Go back now",
    reviewTitle: "We are reviewing your payment",
    reviewBody: "We found your payment but need a quick manual check (for example the amount differs). Please wait or contact {shop}. Do not pay again.",
    expiredTitle: "This payment has expired",
    expiredBody: "Please go back to {shop} and start a new payment. If you already paid, contact the shop with your TrxID.",
    notFoundTitle: "Payment not found",
    notFoundBody: "This link is not valid. Please start again from the shop.",
    closedTitle: "This payment is closed",
    used: "This TrxID was already used for another payment.",
    tooMany: "Too many attempts. Please contact the shop.",
    wrongMethod: "That receipt is a different kind of transaction than this payment needs. Please pay as shown above.",
    invalid: "The TrxID format is not correct",
    failed: "Could not reach the server. Check your internet and try again.",
    noWallet: "No payment number is available right now. Please try again in a few minutes or contact the shop.",
    badLink: "This link is missing its payment method. Please start again from the shop.",
    retry: "Try again",
    loading: "Loading…",
  },
};

const cash: Record<Lang, Dict> = {
  bn: {
    sub: "কম বা বেশি ক্যাশআউট করবেন না",
    amountNote: "আপনি যদি টাকার পরিমাণ পরিবর্তন করেন ({amount}), আপনি ক্রেডিট পেতে সক্ষম হবেন না।",
    walletOnly: "এই {P} নাম্বারে শুধুমাত্র ক্যাশআউট গ্রহণ করা হয়",
    trxLabel: "ক্যাশআউটের TrxID নাম্বারটি লিখুন",
    required: "(প্রয়োজন)",
    link: "কিভাবে TrxID পেতে হয় তা দেখতে ক্লিক করুন",
    placeholder: "TrxID অবশ্যই পূরণ করতে হবে!",
    confirm: "নিশ্চিত",
    warnTitle: "সতর্কতাঃ",
    warnRed: "লেনদেন আইডি সঠিকভাবে পূরণ করতে হবে, অন্যথায় স্কোর ব্যর্থ হবে! !",
    warnGray: "অনুগ্রহ করে নিশ্চিত হয়ে নিন যে আপনি {P} deposit ওয়ালেট নাম্বারে ক্যাশ আউট করছেন। এই নাম্বারের অন্য কোন ওয়ালেট থেকে ক্যাশ আউট করলে সেই টাকা পাওয়ার কোন সম্ভাবনা নাই",
  },
  en: {
    sub: "Do not cash out less or more",
    amountNote: "If you change the amount ({amount}), you will not be credited.",
    walletOnly: "Only Cash Out is accepted on this {P} number",
    trxLabel: "Enter the TrxID of your Cash Out",
    required: "(Required)",
    link: "Click to see how to get the TrxID",
    placeholder: "TrxID is required!",
    confirm: "Confirm",
    warnTitle: "Warning:",
    warnRed: "Enter the transaction ID correctly, otherwise the payment will fail! !",
    warnGray: "Please make sure you are cashing out to the {P} deposit wallet number. Cash Out from any other wallet to this number cannot be credited.",
  },
};

const send: Record<Lang, Dict> = {
  bn: {
    sub: "অতিরিক্ত বা কম টাকা উত্তোলন করবেন না।",
    amountNote: "আপনি যদি টাকার পরিমাণ পরিবর্তন করেন ({amount}), আপনি ক্রেডিট পেতে সক্ষম হবেন না।",
    walletOnly: "এই {P} নাম্বারে শুধুমাত্র Send-Money গ্রহণ করা হয়",
    trxLabel: "Transaction ID",
    required: "(Required)",
    link: "TrxID কিভাবে পাবেন তা দেখতে ক্লিক করুন",
    placeholder: "লেনদেন আইডি লিখুন",
    confirm: "নিশ্চিত করুন",
    warnTitle: "সতর্কতা:",
    warnRed: "লেনদেন আইডি সঠিকভাবে পূরণ করতে হবে, অন্যথায় স্কোর ব্যর্থ হবে",
    warnGray: "অনুগ্রহ করে নিশ্চিত হয়ে নিন যে আপনি {P} ডিপোজিট ওয়ালেট নম্বরে ক্যাশ ইন করেছেন। এই নম্বরের অন্য কোনো ওয়ালেট থেকে টাকা পাঠালে সেই টাকা পাওয়ার কোনো সম্ভাবনা নেই।",
  },
  en: {
    sub: "Do not send more or less money.",
    amountNote: "If you change the amount ({amount}), you will not be credited.",
    walletOnly: "Only Send Money is accepted on this {P} number",
    trxLabel: "Transaction ID",
    required: "(Required)",
    link: "Click to see how to get the TrxID",
    placeholder: "Enter the transaction ID",
    confirm: "Confirm",
    warnTitle: "Warning:",
    warnRed: "Enter the transaction ID correctly, otherwise the payment will fail",
    warnGray: "Please make sure you sent the money to the {P} deposit wallet number. Money sent from any other wallet to this number cannot be credited.",
  },
};

/** Looks up a phrase for a layout and fills in {name} placeholders. */
export function t(lang: Lang, variant: Variant, key: string, vars: Record<string, string> = {}): string {
  const raw = (variant === "send" ? send : cash)[lang][key] ?? common[lang][key] ?? common.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/** "BDT 1,000" (cash out layout) or "BDT 500.00" (send money layout). */
export function bdt(amount: number, currency: string, twoDecimals: boolean): string {
  const n = twoDecimals
    ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${n}`;
}

/** hh:mm:ss, as the reference pages count down. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
