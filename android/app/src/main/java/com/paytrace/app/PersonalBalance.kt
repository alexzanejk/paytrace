package com.paytrace.app

import android.content.Context
import android.os.Handler
import android.os.Looper

/** The balance of a PERSONAL bKash account, by USSD (owner's recording 2026-11-17, a personal account on a Xiaomi):
 *
 *    *247#  -> "bKash 1.Send Money 2.Send Money to Non-bKash User 3.Mobile Recharge 4.Payment 5.Cash Out 6.Pay Bill
 *               7.Microfinance 8.Download bKash App 9.My bKash 10.Reset PIN"            -> 9 (My bKash)
 *           -> "bKash 1.Check Balance 2.Request Statement 3.Change PIN 4.Priyo Numbers 5.Save Bill 6.Update MNP
 *               7.Confirm iPhone Login 8.iPhone PIN Reset 9.Helpline 0.Main Menu"      -> 1 (Check Balance)
 *           -> "Enter PIN:"                                                              -> the personal account's PIN
 *           -> "bKash Current balance Tk 17,205.08. Available balance Tk 17,205.08. 0. Main Menu"
 *
 *  Read only. The menu numbers are read from the menu itself ("9.My bKash", "1.Check Balance"), so a reordered menu
 *  still works, and a menu without them stops the run. The AGENT menu (wrong SIM) stops it before anything is typed,
 *  and the PIN is typed only on a plain "Enter PIN" screen that mentions no amount, number or receipt. */
object PersonalBalanceRead {
    private fun option(menu: String, label: String): String? =
        Regex("""(?:^|\s)(\d{1,2})\s*[.)]\s*""" + Regex.escape(label), RegexOption.IGNORE_CASE).find(menu)?.groupValues?.get(1)

    /** The number to press for "My bKash" on the personal main menu. */
    fun myBkash(menu: String): String? = option(menu, "My bKash")

    /** The number to press for "Check Balance" on the My bKash menu. */
    fun checkBalance(menu: String): String? = option(menu, "Check Balance")
}

/** One personal balance check, one screen at a time. Unit tested in PersonalBalanceTest with the recording's screens. */
class PersonalBalanceFlow(private val pin: () -> String) : BalanceFlow {
    private var stage = 0 // 0 personal menu, 1 My bKash menu, 2 PIN, 3 balance
    private var screens = 0
    private var lastAnswered: String? = null
    private var saidNo = false

    override fun recognises(text: String): Boolean =
        BkashUssd.classify(text) != UssdScreen.OTHER || BkashPersonal.isPersonalMenu(text) || BkashPersonal.isAgentMenu(text)

    override fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        if (clean == lastAnswered) return UssdAction.Wait
        val kind = BkashUssd.classify(clean)
        if (kind == UssdScreen.PROGRESS) return UssdAction.Wait
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")
        return when (stage) {
            0 -> when {
                kind == UssdScreen.CONTINUE_ASK ->
                    if (saidNo) UssdAction.Fail("unexpected_screen") else { saidNo = true; lastAnswered = clean; UssdAction.Reply(UssdAsk.NO) }
                UssdAsk.refused(clean) -> UssdAction.Fail("wallet_refused")
                // The agent account answered: the wrong SIM. Nothing typed.
                BkashPersonal.isAgentMenu(clean) -> UssdAction.Fail("no_personal")
                BkashPersonal.isPersonalMenu(clean) -> {
                    val pick = PersonalBalanceRead.myBkash(clean)
                    if (pick == null) UssdAction.Fail("unexpected_screen") else { stage = 1; lastAnswered = clean; UssdAction.Reply(pick) }
                }
                else -> UssdAction.Fail("unexpected_screen")
            }
            1 -> {
                val pick = if (kind == UssdScreen.ACCOUNT_MENU) PersonalBalanceRead.checkBalance(clean) else null
                if (pick == null) UssdAction.Fail("unexpected_screen") else { stage = 2; lastAnswered = clean; UssdAction.Reply(pick) }
            }
            2 -> if (kind == UssdScreen.ENTER_PIN) {
                val p = pin()
                if (p.isEmpty()) UssdAction.Fail("no_pin") else { stage = 3; lastAnswered = clean; UssdAction.Reply(p, secret = true) }
            } else UssdAction.Fail("unexpected_screen")
            else -> {
                val b = if (kind == UssdScreen.BALANCE) BkashUssd.balanceOf(clean) else null
                if (b == null) UssdAction.Fail(if (UssdAsk.refused(clean)) "wallet_refused" else "unexpected_screen") else UssdAction.Done(b)
            }
        }
    }

    // The walk is 4 screens, plus a possible "Do you want to continue?" in front, plus one spare.
    companion object { const val MAX_SCREENS = 6 }
}

/** What the dashboard is told, one line per personal account. Pure, unit tested; the dashboard reads these lines
 *  (lib/personalBalance.ts) and the two must keep the same shape. */
object PersonalBalanceReport {
    const val HEAD = "Personal bKash balance"

    fun line(n: Int, number: String, slot: Int, outcome: UssdOutcome): String {
        val who = "account $n $number SIM ${slot + 1}"
        return if (outcome.ok && outcome.balance != null) "$who: Tk " + String.format(java.util.Locale.US, "%.2f", outcome.balance)
        else "$who: failed ${outcome.error ?: "failed"}"
    }
}

/** Checks every personal bKash account saved on this phone, one after another (a dashboard command, kind "pbalance").
 *  Each one goes through the phone's dialer on its own SIM with its own PIN. A short pause between them lets the
 *  network close the first menu session before the second starts. */
object PersonalBalance {
    const val KIND = "pbalance"
    private const val BETWEEN_MS = 6_000L

    data class Account(val n: Int, val number: String, val slot: Int)

    fun accounts(s: AppSettings): List<Account> = PersonalAccounts.slots.mapNotNull { n ->
        val number = s.personalNumberOf(UssdProviders.BKASH, n)
        val slot = s.personalSlotOf(UssdProviders.BKASH, n)
        if (number.isEmpty() || slot !in 0..1) null else Account(n, number, slot)
    }

    fun runAll(ctx: Context, onFinish: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        if (!s.ussdAllowed) return onFinish(UssdOutcome(false, null, "not_allowed"))
        if (!s.personalAllowed) return onFinish(UssdOutcome(false, null, "personal_off"))
        val list = accounts(s)
        if (list.isEmpty()) return onFinish(UssdOutcome(false, null, "no_personal"))
        val lines = ArrayList<String>()
        val traces = ArrayList<String>()
        var firstError: String? = null
        var anyOk = false
        fun next(i: Int) {
            if (i >= list.size) {
                val summary = (listOf(PersonalBalanceReport.HEAD) + lines).joinToString("\n")
                val screens = listOf(summary)
                val trace = traces.joinToString("\n-- next account --\n")
                onFinish(if (anyOk) UssdOutcome(true, null, null, trace = trace, screens = screens)
                else UssdOutcome(false, null, firstError ?: "failed", trace = (summary + "\n" + trace).trim(), screens = screens))
                return
            }
            val a = list[i]
            UssdRunner.runPersonalBalance(app, a.n, a.slot) { outcome ->
                lines.add(PersonalBalanceReport.line(a.n, a.number, a.slot, outcome))
                if (outcome.trace.isNotBlank()) traces.add(outcome.trace)
                if (outcome.ok) anyOk = true else if (firstError == null) firstError = outcome.error
                if (i + 1 < list.size) Handler(Looper.getMainLooper()).postDelayed({ next(i + 1) }, BETWEEN_MS) else next(i + 1)
            }
        }
        next(0)
    }
}
