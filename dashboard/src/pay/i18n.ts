// Wording for the customer's pay page, in Bangla and English. Plain text only: nothing here is ever rendered as HTML.
export type Lang = "bn" | "en";

export const PROVIDER_NAME: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
/** Brand colours for the banner and the provider buttons. */
export const PROVIDER_COLOR: Record<string, string> = { bkash: "#b8269c", nagad: "#e8472b", rocket: "#7b2d8e", upay: "#0b6cb5" };

type Dict = Record<string, string>;

const en: Dict = {
  amountNote: "Do not send a different amount. If you change the amount, we cannot credit you.",
  expiresIn: "Time left to pay",
  noWallet: "No payment number is available right now. Please try again in a few minutes or contact the shop.",
  walletNo: "Wallet number",
  sendMoneyOnly: "Send Money to this {p} number only",
  cashOutOnly: "Cash Out to this {p} agent number only",
  stepsTitle: "How to pay",
  stepSend1: "Open your {p} app and choose Send Money.",
  stepSend2: "Send exactly {amount} to the number above.",
  stepCash1: "Open your {p} app and choose Cash Out.",
  stepCash2: "Choose the agent option and enter the number above, for exactly {amount}.",
  step3: "Copy the Transaction ID (TrxID) from the confirmation message and paste it below.",
  trxLabel: "Transaction ID (TrxID)",
  trxHint: "Where do I find the TrxID?",
  trxHelp: "After you pay, {p} sends you an SMS and shows a receipt. The TrxID is the letters and numbers after “TrxID”.",
  trxPlaceholder: "Enter the TrxID",
  confirm: "Confirm",
  confirming: "Checking…",
  warnTitle: "Important",
  warn1: "Enter the TrxID exactly, or the payment cannot be found.",
  warn2: "Pay only this number. Money sent to any other number cannot be credited and cannot be recovered.",
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
  invalid: "Enter a valid TrxID (letters and numbers only).",
  failed: "Could not reach the server. Check your internet and try again.",
  wrongAmountHint: "If the amount you sent was different, the payment will be held for review.",
  copy: "Copy",
  copied: "Copied",
  deposit: "Deposit",
  badLink: "This link is missing its payment method. Please start again from the shop.",
  retry: "Try again",
  loading: "Loading…",
  to: "Pay to",
  secure: "Secure payment",
};

const bn: Dict = {
  amountNote: "অন্য কোনো পরিমাণ পাঠাবেন না। পরিমাণ বদলালে আপনার টাকা জমা হবে না।",
  expiresIn: "পেমেন্টের বাকি সময়",
  noWallet: "এখন কোনো পেমেন্ট নম্বর পাওয়া যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন বা দোকানের সাথে যোগাযোগ করুন।",
  walletNo: "ওয়ালেট নম্বর",
  sendMoneyOnly: "এই {p} নম্বরে শুধুমাত্র Send Money করুন",
  cashOutOnly: "এই {p} এজেন্ট নম্বরে শুধুমাত্র Cash Out করুন",
  stepsTitle: "কীভাবে পেমেন্ট করবেন",
  stepSend1: "আপনার {p} অ্যাপ খুলে Send Money বেছে নিন।",
  stepSend2: "উপরের নম্বরে ঠিক {amount} পাঠান।",
  stepCash1: "আপনার {p} অ্যাপ খুলে Cash Out বেছে নিন।",
  stepCash2: "এজেন্ট অপশন বেছে উপরের নম্বরটি দিন এবং ঠিক {amount} Cash Out করুন।",
  step3: "কনফার্মেশন মেসেজ থেকে ট্রানজেকশন আইডি (TrxID) কপি করে নিচে লিখুন।",
  trxLabel: "ট্রানজেকশন আইডি (TrxID)",
  trxHint: "TrxID কোথায় পাবেন?",
  trxHelp: "পেমেন্টের পর {p} আপনাকে একটি SMS পাঠায় এবং রসিদ দেখায়। “TrxID” এর পরের অক্ষর ও সংখ্যাগুলোই আপনার TrxID।",
  trxPlaceholder: "TrxID লিখুন",
  confirm: "নিশ্চিত করুন",
  confirming: "যাচাই হচ্ছে…",
  warnTitle: "সতর্কতা",
  warn1: "TrxID ঠিকভাবে লিখুন, না হলে পেমেন্ট খুঁজে পাওয়া যাবে না।",
  warn2: "শুধু এই নম্বরেই পেমেন্ট করুন। অন্য নম্বরে পাঠানো টাকা জমা হবে না এবং ফেরত পাওয়া যাবে না।",
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
  invalid: "সঠিক TrxID লিখুন (শুধু অক্ষর ও সংখ্যা)।",
  failed: "সার্ভারে পৌঁছানো যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।",
  wrongAmountHint: "আপনি অন্য পরিমাণ পাঠালে পেমেন্টটি পর্যালোচনার জন্য আটকে থাকবে।",
  copy: "কপি",
  copied: "কপি হয়েছে",
  deposit: "ডিপোজিট",
  badLink: "এই লিংকে পেমেন্ট পদ্ধতি নেই। অনুগ্রহ করে দোকান থেকে আবার শুরু করুন।",
  retry: "আবার চেষ্টা করুন",
  loading: "লোড হচ্ছে…",
  to: "পেমেন্ট করুন",
  secure: "নিরাপদ পেমেন্ট",
};

export const DICT: Record<Lang, Dict> = { en, bn };

/** Looks up a phrase and fills in {name} placeholders. */
export function t(lang: Lang, key: string, vars: Record<string, string> = {}): string {
  const raw = DICT[lang][key] ?? DICT.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export function money(amount: number, currency: string): string {
  const n = Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency === "BDT" ? "৳" : currency + " "}${n}`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
