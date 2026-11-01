package com.paytrace.app

/** What one USSD dialog on the screen is, judged only from its own words. Pure, so it is unit tested with the real
 *  screens of the owner's Nagad recordings (2026-11-01). */
enum class UssdScreen { MAIN_MENU, MY_NAGAD_MENU, ENTER_PIN, BALANCE, PROGRESS, OTHER }

/** What the runner should do next. */
sealed class UssdAction {
    /** Type [text] into the dialog and press Send. [secret] marks the PIN: it is never logged or kept by the flow. */
    data class Reply(val text: String, val secret: Boolean = false) : UssdAction()
    data class Done(val balance: Double) : UssdAction()
    data class Fail(val reason: String) : UssdAction()
    /** Nothing to do yet (the dialog has not changed, or the phone is still working). */
    object Wait : UssdAction()
}

object NagadUssd {
    const val CODE = "*167#"
    private val BALANCE = Regex("""Balance\s*:?\s*Tk\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)

    fun balanceOf(text: String): Double? =
        BALANCE.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

    /** Anything that moves or confirms money. The balance flow must never be on such a screen. */
    private fun mentionsMoneyMove(t: String): Boolean =
        t.contains("amount") || t.contains("to:") || t.contains("cash in") || t.contains("successful") ||
            t.contains("trxid") || t.contains("account number")

    fun classify(text: String): UssdScreen {
        val t = text.lowercase()
        if (t.contains("code running") || t.contains("please wait")) return UssdScreen.PROGRESS
        return when {
            // The menus come first: the main menu lists "Cash In" but is only a menu.
            t.contains("balance enquiry") && t.contains("mini statement") -> UssdScreen.MY_NAGAD_MENU
            t.contains("register customer") && t.contains("my nagad") -> UssdScreen.MAIN_MENU
            t.contains("enter pin") && !mentionsMoneyMove(t) -> UssdScreen.ENTER_PIN
            BALANCE.containsMatchIn(text) && !mentionsMoneyMove(t) -> UssdScreen.BALANCE
            else -> UssdScreen.OTHER
        }
    }
}

/** The balance check, one screen at a time: main menu -> "6" (My Nagad) -> "1" (Balance Enquiry) -> PIN -> balance.
 *
 *  Safety rules, all covered by tests:
 *  - every step must be the screen expected at that point; anything else stops the run (nothing is guessed);
 *  - the PIN is typed once, only on a screen that is a plain "Enter PIN" with no amount or account on it;
 *  - a wrong-PIN or any other unexpected answer is never retried (repeated wrong PINs can lock the wallet);
 *  - at most [MAX_SCREENS] screens, so it can never loop. */
class NagadBalanceFlow(private val pin: () -> String) {
    private var stage = 0 // 0 expect main menu, 1 expect My Nagad menu, 2 expect PIN, 3 expect balance
    private var screens = 0
    private var lastAnswered: String? = null

    fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        // The same dialog reported again (several accessibility events for one change): do nothing.
        if (clean == lastAnswered) return UssdAction.Wait
        val kind = NagadUssd.classify(clean)
        if (kind == UssdScreen.PROGRESS) return UssdAction.Wait
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")
        return when {
            kind == UssdScreen.MAIN_MENU && stage == 0 -> { stage = 1; answered(clean); UssdAction.Reply("6") }
            kind == UssdScreen.MY_NAGAD_MENU && stage == 1 -> { stage = 2; answered(clean); UssdAction.Reply("1") }
            kind == UssdScreen.ENTER_PIN && stage == 2 -> {
                val p = pin()
                if (p.isEmpty()) UssdAction.Fail("no_pin")
                else { stage = 3; answered(clean); UssdAction.Reply(p, secret = true) }
            }
            kind == UssdScreen.BALANCE && stage == 3 -> {
                val b = NagadUssd.balanceOf(clean)
                if (b == null) UssdAction.Fail("unexpected_screen") else UssdAction.Done(b)
            }
            else -> UssdAction.Fail("unexpected_screen")
        }
    }

    private fun answered(text: String) { lastAnswered = text }

    companion object { const val MAX_SCREENS = 6 }
}

/** Labels of buttons the dialer shows, judged from their accessibility description, text or view id. Pure, unit tested. */
object UssdLabels {
    private val CALL_WORDS = setOf("dial", "call", "make a call", "voice call", "start call", "কল", "কল করুন")
    private val CALL_IDS = listOf("dialpad_floating_action_button", "dial_button", "dialbutton", "call_button", "callbutton", "btn_call", "btn_dial", "fab_dial", "dialpad_fab")

    /** The dialer's Call button (an icon; its description or text is "Dial" or "Call"). Never "Call history" or a contact's call button. */
    fun isCallButton(label: String?): Boolean {
        val d = label?.trim()?.lowercase() ?: return false
        return d in CALL_WORDS
    }

    /** The same button found by its view id, for dialers that give the icon no description. */
    fun isCallButtonId(id: String?): Boolean {
        val last = id?.substringAfterLast('/')?.substringAfterLast(':')?.lowercase() ?: return false
        return last.isNotEmpty() && CALL_IDS.any { last.contains(it) }
    }
}

/** When a failed run may be tried once more by itself. Never after the PIN was really submitted (a repeated PIN can lock the
 *  wallet), never for a missing setup, and only once. */
object UssdRetry {
    private val NEVER = setOf("not_allowed", "no_accessibility", "no_call_permission", "no_pin", "busy", "unsupported", "no_answer_after_pin")

    fun shouldRetry(error: String?, ok: Boolean, pinSent: Boolean, attempt: Int): Boolean =
        !ok && !pinSent && attempt < 2 && error != null && error !in NEVER
}
