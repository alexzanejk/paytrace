package com.paytrace.app

/** One cash-in the owner asked for from the dashboard: this much money, to this number, from this wallet. */
data class CashInOrder(val provider: String, val number: String, val amount: Double) {
    /** A Bangladesh mobile number and an amount the phone is willing to send at all. The database checks the same
     *  things; this is the second lock, on the phone, so a wrong command can never get as far as the PIN. */
    fun sane(): Boolean =
        NUMBER.matches(number) && amount > 0 && amount <= MOST && amount == Math.round(amount * 100.0) / 100.0

    companion object {
        /** The most PayTrace will ever send in one command, whatever it is told. */
        const val MOST = 10_000.0
        private val NUMBER = Regex("^01[0-9]{9}$")
    }
}

/** Reading the screens of a cash-in, and deciding what may be typed on each one. Pure, so every rule is unit tested.
 *
 *  THE RULE THAT MATTERS: the PIN is typed only on a screen that shows BOTH the number the money is going to AND the
 *  amount, and both must match the command exactly. Every wallet shows that screen before it asks for the PIN (the
 *  owner's Nagad recording: "Cash In / To: <number> / Amount: Tk 100.00 / Enter PIN:"). A screen PayTrace cannot read,
 *  or one whose number or amount does not match, stops the run before anything secret is typed and before money moves. */
object CashInRead {
    private val DIGITS = Regex("[0-9][0-9,]*(?:\\.[0-9]{1,2})?")
    private val TRX = Regex("""TrxID\s*:?\s*([A-Za-z0-9]{4,24})""", RegexOption.IGNORE_CASE)

    fun asksForNumber(text: String): Boolean {
        val t = text.lowercase()
        return (t.contains("account number") || t.contains("receiver") || t.contains("mobile number") ||
            t.contains("enter number") || t.contains("account no")) && !t.contains("amount")
    }

    fun asksForAmount(text: String): Boolean {
        val t = text.lowercase()
        return t.contains("amount") && !t.contains("pin")
    }

    fun asksForPin(text: String): Boolean = text.lowercase().contains("pin")

    /** Every number on a screen, commas removed, so "Tk 1,000.00" and "100" are both read. */
    fun numbersOn(text: String): List<Double> =
        DIGITS.findAll(text).mapNotNull { it.value.replace(",", "").toDoubleOrNull() }.toList()

    /** True only when this screen really is the wallet's own confirmation of THIS cash-in. */
    fun confirms(text: String, order: CashInOrder): Boolean {
        if (!text.contains(order.number)) return false
        return numbersOn(text).any { Math.abs(it - order.amount) < 0.005 }
    }

    fun trxOn(text: String): String? = TRX.find(text)?.groupValues?.get(1)

    /** The wallet says it is done: a receipt number and the words of a finished cash-in. */
    fun succeeded(text: String): Boolean {
        val t = text.lowercase()
        return trxOn(text) != null && (t.contains("successful") || t.contains("success") || t.contains("completed"))
    }

    /** How the amount is typed into the wallet's own box: whole takas have no decimals, as a person would type. */
    fun typed(amount: Double): String {
        val whole = Math.round(amount).toDouble()
        return if (Math.abs(amount - whole) < 0.005) Math.round(amount).toString()
        else String.format(java.util.Locale.US, "%.2f", amount)
    }
}

/** A cash-in, one screen at a time: main menu -> "1" -> the number -> the amount -> (the wallet's confirmation) -> the
 *  PIN -> the receipt. Written to be driven by the same runner as a balance check.
 *
 *  Safety, all unit tested:
 *  - every step must be the screen expected at that point; anything else stops the run;
 *  - the PIN is typed once, and only on a screen that shows this cash-in's own number AND amount;
 *  - a wallet's refusal, a wrong PIN or any answer PayTrace does not know stops the run and is never retried;
 *  - at most [MAX_SCREENS] screens, so it can never loop. */
class CashInFlow(private val order: CashInOrder, private val pin: () -> String) : BalanceFlow {
    private var stage = 0 // 0 main menu, 1 number, 2 amount, 3 confirm+PIN, 4 receipt
    private var screens = 0
    private var lastAnswered: String? = null
    private var saidNo = false
    private val wallet = order.provider

    override fun recognises(text: String): Boolean =
        UssdProviders.classify(wallet, text) != UssdScreen.OTHER ||
            CashInRead.asksForNumber(text) || CashInRead.asksForAmount(text) ||
            CashInRead.asksForPin(text) || CashInRead.succeeded(text) || UssdAsk.refused(text)

    override fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        if (clean == lastAnswered) return UssdAction.Wait
        if (UssdProviders.classify(wallet, clean) == UssdScreen.PROGRESS) return UssdAction.Wait
        if (!order.sane()) return UssdAction.Fail("bad_cash_in")
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")

        // The wallet said no, in its own words ("Amount too low to transact.", "Wrong PIN", a limit). Stop; never try
        // again. Not checked where the confirmation is expected: that screen has its own strict rule below, and nothing
        // may weaken it. A refusal means the wallet rejected the request, so no money moved.
        if (stage != 3 && UssdAsk.refused(clean)) return UssdAction.Fail("wallet_refused")

        return when (stage) {
            // bKash can ask "Do you want to continue?" before the menu, when an earlier session was left open.
            // Answer No once: that starts a fresh menu. Yes would carry on a half-finished transaction.
            0 -> if (UssdAsk.wantsToContinue(clean)) {
                if (saidNo) UssdAction.Fail("unexpected_screen")
                else { saidNo = true; answered(clean); UssdAction.Reply(UssdAsk.NO) }
            } else if (UssdProviders.classify(wallet, clean) == UssdScreen.MAIN_MENU) {
                stage = 1; answered(clean); UssdAction.Reply("1")
            } else UssdAction.Fail("unexpected_screen")

            1 -> if (CashInRead.asksForNumber(clean)) {
                stage = 2; answered(clean); UssdAction.Reply(order.number)
            } else UssdAction.Fail("unexpected_screen")

            2 -> if (CashInRead.asksForAmount(clean) && !CashInRead.asksForPin(clean)) {
                stage = 3; answered(clean); UssdAction.Reply(CashInRead.typed(order.amount))
            } else UssdAction.Fail("unexpected_screen")

            // The one that matters: the wallet must be asking for the PIN on a screen that shows this very cash-in.
            3 -> when {
                !CashInRead.asksForPin(clean) -> UssdAction.Fail("unexpected_screen")
                !CashInRead.confirms(clean, order) -> UssdAction.Fail("confirm_does_not_match")
                else -> {
                    val p = pin()
                    if (p.isEmpty()) UssdAction.Fail("no_pin")
                    else { stage = 4; answered(clean); UssdAction.Reply(p, secret = true) }
                }
            }

            else -> if (CashInRead.succeeded(clean)) {
                val balance = UssdProviders.balanceOn(wallet, clean) ?: 0.0
                UssdAction.Done(balance, CashInRead.trxOn(clean))
            } else UssdAction.Fail("unexpected_screen")
        }
    }

    private fun answered(text: String) { lastAnswered = text }

    // One more than the walk needs, because bKash can put a "Do you want to continue?" question in front of the menu.
    companion object { const val MAX_SCREENS = 9 }
}
