// What the bot writes back in the group, and when. Pure, no I/O, unit tested (tests/telegram.test.ts).
//
// The bot's ordinary word is a thumbs-up REACTION on a matched post (sent by index.ts, not here). TEXT replies follow the
// owner's reply mode (telegram_settings.reply_mode), OFF by default (owner 2026-11-20: no match = no reaction, no reply):
// problems = only when something needs the poster (TrxID unreadable, transaction held, already submitted); all = also a
// short "received" on every match. Bangla first, a short English line after. "Received" never says "found" or "verified" (the 2026-11-04 lesson: পাওয়া গেছে reads as
// proven), because a match only means PayTrace holds that TrxID; paying out is a separate, human step.

export type ReplyMode = "off" | "problems" | "all";
export type ClaimStatus = "new" | "unmatched" | "matched" | "paid" | "held" | "duplicate" | "conflict" | "review" | "ignored";

export interface ReplyInput {
  status: ClaimStatus;
  kind: "photo" | "text";
  ocrStatus: "none" | "pending" | "done" | "failed";
  trx?: string | null;
  amount?: number | null;
  mode: ReplyMode;
}

const taka = (n: number) => "Tk " + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const clean = (s: unknown, max = 20) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, max);

/** The reply to send for a claim in this state, or null for silence. A photo whose OCR has not run yet is never answered
 *  (the answer comes after the read); a conflict is answered neutrally (the group is public). */
export function replyFor(i: ReplyInput): { kind: string; text: string } | null {
  if (i.mode === "off") return null;
  const trx = clean(i.trx);
  switch (i.status) {
    case "new":
      return null;
    case "matched":
      if (i.mode !== "all") return null;
      return { kind: "received", text: `✅ TrxID ${trx} জমা হয়েছে${i.amount != null ? ` (${taka(i.amount)})` : ""}। প্রসেস করা হবে।\nReceived, will be processed.` };
    case "held":
      return { kind: "held", text: `⏳ TrxID ${trx} যাচাই করা হচ্ছে। একটু অপেক্ষা করুন।\nThis TrxID is being checked, please wait.` };
    case "unmatched":
      // A photo is asked for the TrxID as text only once its OCR is finished (or has given up).
      if (i.kind === "photo" && i.ocrStatus === "pending") return null;
      return { kind: "ask_trx", text: "❓ TrxID পড়া যায়নি। অনুগ্রহ করে TrxID-টি লিখে রিপ্লাই দিন।\nCould not read the TrxID, please reply with the TrxID as text." };
    case "duplicate":
      return { kind: "duplicate", text: `ℹ️ TrxID ${trx} আগেই জমা দেওয়া হয়েছে।\nThis TrxID was already submitted.` };
    case "conflict":
      return { kind: "conflict", text: `⚠️ TrxID ${trx} আগেই জমা হয়েছে; অ্যাডমিন দেখবেন।\nThis TrxID was already submitted; an admin will check.` };
    case "paid":
    case "review":
    case "ignored":
      return null;
  }
}

/** What the bot says when a person opens a private chat with it (migration 119): the one way Telegram lets a bot
 *  message a person privately is after that person wrote to it first, so this confirms what they get for it. `first`
 *  = the first private message from this person; later ones get a shorter line. Never a number, never an amount. */
export function welcomeText(first: boolean): string {
  if (first) {
    return "✅ ধন্যবাদ! এখন থেকে আপনার পেমেন্ট পাঠানো হলে খবরটি এখানে ব্যক্তিগতভাবে পাবেন।\nThanks! From now on you will get a private message here when your payment is sent.";
  }
  return "ℹ️ এই চ্যাটে শুধু পেমেন্টের খবর আসে। TrxID বা স্ক্রিনশট গ্রুপে পোস্ট করুন।\nThis chat only carries your payment notices. Please post your TrxID or screenshot in the group.";
}
