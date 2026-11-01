package com.paytrace.app

/** What one USSD dialog on the screen is, judged only from its own words. Pure, so it is unit tested with the real
 *  screens of the owner's Nagad recordings (2026-11-01). */
enum class UssdScreen { MAIN_MENU, MY_NAGAD_MENU, ACCOUNT_MENU, ENTER_PIN, BALANCE, PROGRESS, OTHER }

/** One balance check as a walk through a provider's USSD menus (Nagad and bKash each have their own). It is fed the text of each
 *  screen the phone shows or the network sends back, and says what to answer. */
interface BalanceFlow {
    fun onScreen(text: String): UssdAction

    /** True if [text] is one of the provider's own USSD screens (a menu, the PIN prompt, the balance, "running..."). */
    fun recognises(text: String): Boolean
}

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

    /** The whole balance check as ONE code with the PIN inside: "*167*6*1*<PIN>#" (confirmed on the owner's phones 2026-11-01:
     *  the network answers with the balance directly). Null unless the PIN is 4 to 8 digits, so nothing else (a "*", a "#")
     *  can ever be slipped into a code the phone sends. */
    fun balanceCode(pin: String): String? = if (PIN.matches(pin)) "*167*6*1*$pin#" else null

    /** The balance ONLY when the words are a plain balance answer. Used where text is read in bulk (the phone log), so a
     *  cash-in receipt, which also prints a balance, can never be taken for the answer to a balance enquiry. */
    fun balanceOnly(text: String): Double? = if (classify(text) == UssdScreen.BALANCE) balanceOf(text) else null
    private val PIN = Regex("^[0-9]{4,8}$")

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
class NagadBalanceFlow(private val pin: () -> String) : BalanceFlow {
    private var stage = 0 // 0 expect main menu, 1 expect My Nagad menu, 2 expect PIN, 3 expect balance
    private var screens = 0
    private var lastAnswered: String? = null

    override fun recognises(text: String): Boolean = NagadUssd.classify(text) != UssdScreen.OTHER

    override fun onScreen(text: String): UssdAction {
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

/** bKash (agent menu), from the owner's recording 2026-11-01. bKash does NOT take one long code: `*247*4*1*PIN#` answers
 *  "service is not available". It has to be walked step by step:
 *  `*247#` -> menu "1 Cash In, 2 B2B Transfer, 3 Pay Bill, 4 My bKash, 5 Helpline" -> `4` -> menu "1 Check Balance, 2 Request Statement,
 *  3 Change Mobile Menu PIN, 4 Update MNP Info, 0 Main Menu" -> `1` -> "Enter PIN:" -> PIN ->
 *  "Current balance Tk 1,570.78. Available balance Tk 1,570.78. 0. Main Menu". */
object BkashUssd {
    const val CODE = "*247#"
    private val BALANCE = Regex("""Current\s+balance\s*:?\s*Tk\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)

    fun balanceOf(text: String): Double? =
        BALANCE.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

    /** As NagadUssd.balanceOnly: only a plain balance answer counts. */
    fun balanceOnly(text: String): Double? = if (classify(text) == UssdScreen.BALANCE) balanceOf(text) else null

    /** Anything that moves or confirms money. The balance flow must never be on such a screen. */
    private fun mentionsMoneyMove(t: String): Boolean =
        t.contains("amount") || t.contains("to:") || t.contains("successful") || t.contains("trxid") ||
            t.contains("account number") || t.contains("mobile number") || t.contains("enter number")

    fun classify(text: String): UssdScreen {
        val t = text.lowercase()
        if (t.contains("code running") || t.contains("please wait")) return UssdScreen.PROGRESS
        return when {
            // The menus come first: the main menu lists "Cash In" but is only a menu.
            t.contains("check balance") && t.contains("request statement") -> UssdScreen.ACCOUNT_MENU
            t.contains("my bkash") && t.contains("cash in") -> UssdScreen.MAIN_MENU
            t.contains("enter pin") && !mentionsMoneyMove(t) -> UssdScreen.ENTER_PIN
            BALANCE.containsMatchIn(text) && !mentionsMoneyMove(t) -> UssdScreen.BALANCE
            else -> UssdScreen.OTHER
        }
    }
}

/** bKash balance check, one screen at a time: main menu -> "4" (My bKash) -> "1" (Check Balance) -> PIN -> balance.
 *  The same safety rules as the Nagad flow (each step must be the expected screen, the PIN is given once and only on a plain
 *  "Enter PIN" screen, nothing is retried after the PIN, at most [MAX_SCREENS] screens). */
class BkashBalanceFlow(private val pin: () -> String) : BalanceFlow {
    private var stage = 0 // 0 expect main menu, 1 expect the My bKash menu, 2 expect PIN, 3 expect balance
    private var screens = 0
    private var lastAnswered: String? = null

    override fun recognises(text: String): Boolean = BkashUssd.classify(text) != UssdScreen.OTHER

    override fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        if (clean == lastAnswered) return UssdAction.Wait
        val kind = BkashUssd.classify(clean)
        if (kind == UssdScreen.PROGRESS) return UssdAction.Wait
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")
        return when {
            kind == UssdScreen.MAIN_MENU && stage == 0 -> { stage = 1; lastAnswered = clean; UssdAction.Reply("4") }
            kind == UssdScreen.ACCOUNT_MENU && stage == 1 -> { stage = 2; lastAnswered = clean; UssdAction.Reply("1") }
            kind == UssdScreen.ENTER_PIN && stage == 2 -> {
                val p = pin()
                if (p.isEmpty()) UssdAction.Fail("no_pin")
                else { stage = 3; lastAnswered = clean; UssdAction.Reply(p, secret = true) }
            }
            kind == UssdScreen.BALANCE && stage == 3 -> {
                val b = BkashUssd.balanceOf(clean)
                if (b == null) UssdAction.Fail("unexpected_screen") else UssdAction.Done(b)
            }
            else -> UssdAction.Fail("unexpected_screen")
        }
    }

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

    private val POSITIVE_IDS = setOf("button1", "button_positive", "positive_button", "ok", "send", "btn_ok", "btn_send", "confirm_button")
    private val NEGATIVE_IDS = setOf("button2", "button_negative", "negative_button", "cancel", "btn_cancel", "button3")

    /** The dialog's "Send" / "OK" button found by its view id, used when its word is in a language PayTrace does not know. */
    fun isPositiveId(id: String?): Boolean = lastPart(id) in POSITIVE_IDS

    /** The dialog's "Cancel" button, used only to close the menu when a run is over. */
    fun isNegativeId(id: String?): Boolean = lastPart(id) in NEGATIVE_IDS

    private fun lastPart(id: String?): String =
        id?.substringAfterLast('/')?.substringAfterLast(':')?.lowercase() ?: ""
}

/** The words of a screen, cut short and with every long run of digits hidden, so a failed run can say what it saw without
 *  ever putting a PIN, a wallet number or a balance into the log that is sent for help. */
object UssdRedact {
    private val DIGITS = Regex("[0-9][0-9.,]{2,}")

    fun snippet(text: String?, max: Int = 90): String {
        val one = (text ?: "").replace(Regex("\\s+"), " ").trim()
        if (one.isEmpty()) return "(nothing readable)"
        val hidden = DIGITS.replace(one) { "***" }
        return if (hidden.length <= max) hidden else hidden.take(max) + "..."
    }
}

/** When a failed run may be tried once more by itself. Never after the PIN was really submitted (a repeated PIN can lock the
 *  wallet), never for a missing setup, and only once. */
object UssdRetry {
    private val NEVER = setOf("not_allowed", "no_accessibility", "no_call_permission", "no_pin", "busy", "unsupported", "no_answer_after_pin")

    fun shouldRetry(error: String?, ok: Boolean, pinSent: Boolean, attempt: Int): Boolean =
        !ok && !pinSent && attempt < 2 && error != null && error !in NEVER
}

/** Reading the network's answer to the one-line balance code, and what to do when the phone could not send it. Pure, tested. */
object UssdDirect {
    /** A plain "Balance: Tk ..." answer is the result. Anything else (a menu, an error, a cash-in receipt) is not, and is never retried. */
    fun readReply(text: String): UssdAction {
        val t = text.trim()
        val lower = t.lowercase()
        if (lower.contains("trxid") || lower.contains("successful")) return UssdAction.Fail("unexpected_screen")
        val b = NagadUssd.balanceOf(t) ?: return UssdAction.Fail("unexpected_screen")
        return UssdAction.Done(b)
    }

    /** TelephonyManager.USSD_ERROR_SERVICE_UNAVAIL (-2): the phone could not even start it, so nothing reached the network and
     *  the dialer way may be tried. Any other failure (-1 and the rest) may have reached the network with the PIN: never repeated. */
    const val SERVICE_UNAVAILABLE = -2

    fun nothingWasSent(failureCode: Int): Boolean = failureCode == SERVICE_UNAVAILABLE

    fun failureError(failureCode: Int): String = if (nothingWasSent(failureCode)) "dial_failed" else "ussd_failed"

    /** Two checks in a row would hit a menu the network still holds open from the first one. */
    const val COOLDOWN_MS = 45_000L

    fun tooSoon(lastFinishMs: Long, nowMs: Long): Boolean = lastFinishMs > 0 && nowMs >= lastFinishMs && nowMs - lastFinishMs < COOLDOWN_MS
}

/** Some phones will not send a balance code from an app at all: the owner's Vivo V2120 answers "failure code -1" or the network
 *  says "try again later", while the very same code dialed by hand works. Nothing in PayTrace can change that, so instead the
 *  phone notices it: after [ENOUGH] runs in a row where the direct way failed, that phone moves itself to the dialer way for good
 *  (it can be moved back by hand in Settings). Pure, so it is tested. */
object UssdDirectHealth {
    const val ENOUGH = 2

    /** PROVED on the owner's Redmi (phone log, 2026-11-02): Nagad DOES answer the direct request with the balance
     *  ("Balance: Tk 818.35 / 0. Main Menu"), but because the answer offers a next step the network keeps the menu open,
     *  and Android hands an app only the answers that close it. The app is told "failure code -1" and never sees the words.
     *  Nothing in PayTrace can change that, and it will happen on every phone and every try, so one such failure is enough
     *  to move that phone to the dialer way (where the phone's own menu is read instead). */
    fun cannotWorkHere(trace: String): Boolean = trace.contains("failure code -1")

    /** Judged from a finished run's own log. Only the direct way's own failures count, never a wrong PIN or a stopped menu. */
    fun directFailed(trace: String): Boolean {
        val t = trace.lowercase()
        if (!t.contains("direct ussd request") && !t.contains("direct menu walk")) return false
        return t.contains("failure code") || t.contains("direct way could not go on") ||
            t.contains("answer was not a balance") || t.contains("network never answered")
    }

    /** True when this phone should stop trying the direct way. [accessibilityOn] because the dialer way cannot work without it. */
    fun shouldSwitch(failsInARow: Int, accessibilityOn: Boolean): Boolean = accessibilityOn && failsInARow >= ENOUGH

    /** The new count after a run: back to nothing when the direct way did its job, one more when it failed. */
    fun count(before: Int, trace: String, ok: Boolean = false): Int = when {
        // A run that ended with a balance proves the direct way works on this phone, whatever the phone said along the way
        // (with READ_LOGS it answers "failure code -1" and PayTrace still reads the balance out of the phone's log).
        ok -> 0
        cannotWorkHere(trace) -> ENOUGH
        directFailed(trace) -> (before + 1).coerceAtMost(ENOUGH)
        else -> 0
    }
}

/** The wallets a balance check can be run for. */
object UssdProviders {
    const val NAGAD = "nagad"
    const val BKASH = "bkash"
    val all = listOf(NAGAD, BKASH)

    fun isKnown(p: String): Boolean = p == NAGAD || p == BKASH
    fun label(p: String): String = if (p == BKASH) "bKash" else "Nagad"

    /** The code a person dials to open the provider's menu. */
    fun dialCode(p: String): String = if (p == BKASH) BkashUssd.CODE else NagadUssd.CODE

    fun flow(p: String, pin: () -> String): BalanceFlow = if (p == BKASH) BkashBalanceFlow(pin) else NagadBalanceFlow(pin)

    /** Only Nagad takes the whole check as one code; bKash has to be walked one menu at a time. */
    fun oneCode(p: String): Boolean = p == NAGAD
}
