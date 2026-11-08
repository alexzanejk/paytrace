package com.paytrace.app

/** Send Money from a PERSONAL bKash account (owner 2026-11-08: payouts from personal accounts). Built from the owner's
 *  own recording of the personal bKash menu on that day, word for word:
 *
 *    *247#  -> "bKash 1.Send Money 2.Send Money to Non-bKash User 3.Mobile Recharge 4.Payment 5.Cash Out 6.Pay Bill
 *               7.Microfinance 8.Download bKash App 9.My bKash 10.Reset PIN"            -> 1
 *           -> "Enter Receiver bKash Account No:"                                        -> the number
 *           -> "FREE Send Money to 5 Priyo Numbers. Dial *247# and select number 9 to find priyo Numbers. Enter Amount:"
 *           -> "FREE Send Money to 5 Priyo numbers up to 25,000 Tk. every month. Enter Reference:"
 *           -> "Add up to 5 Priyo Numbers to Send Money for FREE. Send Money. To: 01719114383 Amount: Tk 850
 *               Reference: a Enter Menu PIN to confirm:"                                 -> the PIN
 *           -> "Send Money Tk 850.00 to 01719114383 successful. Ref a. Fee Tk 10.00. Balance Tk 14,660.08. TrxID DK817GU2FV"
 *
 *  The same rule as a cash-in, and it must never be weakened: the PIN is typed only on a screen that shows BOTH this
 *  send's number AND its amount. On top of that, the walk only starts from the PERSONAL menu: if the phone opens the
 *  AGENT menu instead (the wrong SIM was picked), it stops before typing anything, so a personal send can never turn
 *  into an agent cash-in. */
object BkashPersonal {
    /** The personal menu: it offers Send Money and Cash Out, and never the agent's Cash In or B2B. */
    fun isPersonalMenu(text: String): Boolean {
        val t = text.lowercase()
        return t.contains("send money") && t.contains("cash out") && t.contains("my bkash") &&
            !t.contains("cash in") && !t.contains("b2b")
    }

    /** The AGENT menu ("1 Cash In / 2 B2B Transfer / 3 Pay Bill / 4 My bKash"): seeing it means the wrong account. */
    fun isAgentMenu(text: String): Boolean {
        val t = text.lowercase()
        return t.contains("my bkash") && (t.contains("cash in") || t.contains("b2b"))
    }

    fun asksForReference(text: String): Boolean {
        val t = text.lowercase()
        return t.contains("reference") && !t.contains("amount") && !UssdAsk.asksForPin(text)
    }

    /** What is typed as the reference. The receiver sees it ("Ref PT"), so it is short and plain. */
    const val REFERENCE = "PT"
}

/** One send, one screen at a time: personal menu -> "1" -> number -> amount -> reference -> (confirmation) PIN -> receipt.
 *  Same safety as [CashInFlow], all unit tested in SendMoneyTest:
 *  - every step must be the screen expected at that point; anything else stops the run;
 *  - the PIN is typed once, and only on a screen showing this send's own number AND amount;
 *  - the agent menu, a refusal, or any unknown answer stops the run and is never retried;
 *  - at most [MAX_SCREENS] screens. */
class SendMoneyFlow(private val order: CashInOrder, private val pin: () -> String) : BalanceFlow {
    private var stage = 0 // 0 menu, 1 number, 2 amount, 3 reference, 4 confirm+PIN, 5 receipt
    private var screens = 0
    private var lastAnswered: String? = null
    private var saidNo = false
    private val wallet = order.provider

    override fun recognises(text: String): Boolean =
        UssdProviders.classify(wallet, text) != UssdScreen.OTHER || BkashPersonal.isPersonalMenu(text) ||
            CashInRead.asksForNumber(text) || CashInRead.asksForAmount(text) || BkashPersonal.asksForReference(text) ||
            CashInRead.asksForPin(text) || CashInRead.succeeded(text) || UssdAsk.refused(text)

    override fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        if (clean == lastAnswered) return UssdAction.Wait
        if (UssdProviders.classify(wallet, clean) == UssdScreen.PROGRESS) return UssdAction.Wait
        if (wallet != UssdProviders.BKASH) return UssdAction.Fail("unsupported")
        if (!order.sane()) return UssdAction.Fail("bad_cash_in")
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")
        if (stage != 4 && UssdAsk.refused(clean)) return UssdAction.Fail("wallet_refused")

        return when (stage) {
            0 -> when {
                UssdAsk.wantsToContinue(clean) ->
                    if (saidNo) UssdAction.Fail("unexpected_screen") else { saidNo = true; answered(clean); UssdAction.Reply(UssdAsk.NO) }
                // The wrong account answered: nothing has been typed, nothing can move. Stop.
                BkashPersonal.isAgentMenu(clean) -> UssdAction.Fail("no_personal")
                BkashPersonal.isPersonalMenu(clean) -> { stage = 1; answered(clean); UssdAction.Reply("1") }
                else -> UssdAction.Fail("unexpected_screen")
            }

            1 -> if (CashInRead.asksForNumber(clean)) {
                stage = 2; answered(clean); UssdAction.Reply(order.number)
            } else UssdAction.Fail("unexpected_screen")

            2 -> if (CashInRead.asksForAmount(clean) && !CashInRead.asksForPin(clean)) {
                stage = 3; answered(clean); UssdAction.Reply(CashInRead.typed(order.amount))
            } else UssdAction.Fail("unexpected_screen")

            3 -> if (BkashPersonal.asksForReference(clean)) {
                stage = 4; answered(clean); UssdAction.Reply(BkashPersonal.REFERENCE)
            } else UssdAction.Fail("unexpected_screen")

            // The one that matters: the PIN only on the wallet's own confirmation of THIS send.
            4 -> when {
                !CashInRead.asksForPin(clean) -> UssdAction.Fail("unexpected_screen")
                !CashInRead.confirms(clean, order) -> UssdAction.Fail("confirm_does_not_match")
                else -> {
                    val p = pin()
                    if (p.isEmpty()) UssdAction.Fail("no_pin")
                    else { stage = 5; answered(clean); UssdAction.Reply(p, secret = true) }
                }
            }

            else -> if (CashInRead.succeeded(clean)) {
                UssdAction.Done(CashInRead.balanceOn(clean) ?: 0.0, CashInRead.trxOn(clean))
            } else UssdAction.Fail("unexpected_screen")
        }
    }

    private fun answered(text: String) { lastAnswered = text }

    // The walk needs 6 screens, plus a possible "Do you want to continue?" in front, plus one spare.
    companion object { const val MAX_SCREENS = 8 }
}
