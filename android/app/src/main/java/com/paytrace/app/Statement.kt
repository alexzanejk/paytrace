package com.paytrace.app

/** Reading a wallet's own statement screens. Pure, so every rule is unit tested against the owner's real bKash agent
 *  menu (2026-11-02).
 *
 *  The list, four entries to a page:
 *
 *      Statement List:
 *      1 02/11/26 Cash In -Tk -200.00
 *      2 29/10/26 Cash Out -Tk 500.00
 *      3 28/10/26 Cash Out -Tk 500.00
 *      4 28/10/26 Cash Out -Tk 500.00
 *      # NEXT
 *
 *  and one entry, chosen by typing its number:
 *
 *      Cash In Tk -200.00
 *      Fee Tk 0.00
 *      From 01706630756
 *      To 01846632612
 *      TrxID DK29URXBHB
 *      At 02/11/2026 06:24:45
 *
 *  PayTrace does NOT try to understand these on the phone. It collects them word for word and sends them on, so the
 *  reading can be corrected later without a new app on every phone — the same reason SMS is parsed on the server. */
object StatementRead {
    /** The wallet offers another page ("# NEXT"). */
    fun hasNextPage(text: String): Boolean = Regex("""#\s*NEXT""", RegexOption.IGNORE_CASE).containsMatchIn(text)

    /** The numbers of the entries listed on this page, as the wallet numbered them. */
    fun entriesOn(text: String): List<Int> =
        text.lines().mapNotNull { line ->
            Regex("""^\s*(\d{1,2})\s+\d""").find(line)?.groupValues?.get(1)?.toIntOrNull()
        }

    fun lists(text: String): Boolean = entriesOn(text).isNotEmpty() || hasNextPage(text)

    /** True when this page is where entry [item] is listed. */
    fun listsEntry(text: String, item: Int): Boolean = entriesOn(text).contains(item)
}

/** One statement run: walk to the wallet's statement, then either collect the list pages, or open one entry.
 *
 *  It only READS. No money moves, nothing is typed but menu numbers and the PIN, and as with every other flow the PIN
 *  goes in only at the step where it is expected and never on a screen that mentions an amount or an account.
 *
 *  bKash:  *247#  ->  4 (My bKash)  ->  2 (Request Statement)  ->  PIN  ->  the list
 *  Nagad:  *167#  ->  6 (My Nagad)  ->  2 (Mini Statement)     ->  PIN  ->  whatever Nagad shows
 *
 *  Nagad's own statement screens have never been seen. That is on purpose survivable: the menu steps are the same
 *  shape, and whatever comes back is sent on as text for us to look at rather than guessed at here. */
class StatementFlow(
    private val wallet: String,
    /** Which entry to open, or null for just the list. */
    private val item: Int?,
    private val pin: () -> String,
) : BalanceFlow {
    private var stage = 0 // 0 main menu, 1 the wallet's own menu, 2 PIN, 3 the list, 4 one entry
    private var screens = 0
    private var pages = 0
    private var lastAnswered: String? = null
    private var saidNo = false
    private val collected = mutableListOf<String>()

    private val menuPick = if (wallet == UssdProviders.BKASH) "4" else "6"
    private val ownMenu = if (wallet == UssdProviders.BKASH) UssdScreen.ACCOUNT_MENU else UssdScreen.MY_NAGAD_MENU

    // Once the PIN has gone in, whatever the wallet shows next IS the answer, in wording nobody has seen before (Nagad's
    // statement especially). So from that point every dialog counts as ours, or the run would ignore the very screen it
    // was asked to fetch.
    override fun recognises(text: String): Boolean =
        stage >= 3 || UssdProviders.classify(wallet, text) != UssdScreen.OTHER ||
            StatementRead.lists(text) || UssdAsk.refused(text)

    override fun onScreen(text: String): UssdAction {
        val clean = text.trim()
        if (clean.isEmpty()) return UssdAction.Wait
        if (clean == lastAnswered) return UssdAction.Wait
        val kind = UssdProviders.classify(wallet, clean)
        if (kind == UssdScreen.PROGRESS) return UssdAction.Wait
        screens++
        if (screens > MAX_SCREENS) return UssdAction.Fail("too_many_steps")
        if (UssdAsk.refused(clean)) return UssdAction.Fail("wallet_refused")

        return when (stage) {
            // bKash can ask "Do you want to continue?" when an earlier session was left open: answer No once.
            0 -> if (UssdAsk.wantsToContinue(clean)) {
                if (saidNo) UssdAction.Fail("unexpected_screen")
                else { saidNo = true; answered(clean); UssdAction.Reply(UssdAsk.NO) }
            } else if (kind == UssdScreen.MAIN_MENU) {
                stage = 1; answered(clean); UssdAction.Reply(menuPick)
            } else UssdAction.Fail("unexpected_screen")

            1 -> if (kind == ownMenu) {
                stage = 2; answered(clean); UssdAction.Reply("2")
            } else UssdAction.Fail("unexpected_screen")

            2 -> if (kind == UssdScreen.ENTER_PIN) {
                val p = pin()
                if (p.isEmpty()) UssdAction.Fail("no_pin")
                else { stage = 3; answered(clean); UssdAction.Reply(p, secret = true) }
            } else UssdAction.Fail("unexpected_screen")

            3 -> onList(clean)

            // The entry's own screen: whatever it says, that is the answer.
            else -> { collected.add(clean); UssdAction.Done(null, null, collected.toList()) }
        }
    }

    private fun onList(clean: String): UssdAction {
        if (!StatementRead.lists(clean)) return UssdAction.Fail("unexpected_screen")
        collected.add(clean)
        pages++
        if (item == null) {
            // Just the list: page on while the wallet offers another one.
            return if (StatementRead.hasNextPage(clean) && pages < MAX_PAGES) {
                answered(clean); UssdAction.Reply(NEXT)
            } else {
                UssdAction.Done(null, null, collected.toList())
            }
        }
        // One entry: page on until the wallet lists it, then ask for it by its own number.
        if (StatementRead.listsEntry(clean, item)) {
            stage = 4; answered(clean); return UssdAction.Reply(item.toString())
        }
        return if (StatementRead.hasNextPage(clean) && pages < MAX_PAGES) {
            answered(clean); UssdAction.Reply(NEXT)
        } else {
            UssdAction.Fail("entry_not_found")
        }
    }

    private fun answered(text: String) { lastAnswered = text }

    companion object {
        /** What the wallet wants typed to move to the next page of the list. */
        const val NEXT = "#"
        /** Four entries to a page, so three pages is twelve transactions: far enough back to find a missing one, and
         *  short enough that the menu session does not run out of time. */
        const val MAX_PAGES = 3
        const val MAX_SCREENS = 12
    }
}
