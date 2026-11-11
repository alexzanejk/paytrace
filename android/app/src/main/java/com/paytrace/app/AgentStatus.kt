package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The bKash agent app's own "agent status" (owner 2026-11-11: after a long time unused bKash shows "স্ট্যাটাস পরিবর্তন
 * করুন ... CLOSE রয়েছে", and while the status is CLOSE the app will not do Cash In or B2B). Mapped from recorder run
 * 65408217: the status is a switch in the side menu ("বিকাশ মেন্যু"), row "এজেন্টের স্ট্যাটাস" with the label খোলা (open) or
 * বন্ধ (closed) and the switch `tag_labeled_switch` beside it; the row above it is the ENGLISH language switch, which
 * must never be touched. Pure parts are unit tested.
 */
object AgentStatusRead {
    const val TITLE = "এজেন্টের স্ট্যাটাস"
    val OPEN = setOf("খোলা", "open")
    val CLOSED = setOf("বন্ধ", "closed", "close")

    /** In the side menu: true = OPEN, false = CLOSED; null = not the side menu or no label. */
    fun drawerStatus(texts: List<String>): Boolean? {
        val i = texts.indexOfFirst { it.trim() == TITLE || it.trim().equals("agent status", ignoreCase = true) }
        if (i < 0) return null
        val label = texts.getOrNull(i + 1)?.trim()?.lowercase() ?: return null
        return when (label) { in OPEN -> true; in CLOSED -> false; else -> null }
    }

    /** The switch on the status row: the one whose middle is closest in height to the title's (never more than [NEAR]
     *  pixels away), so the English switch one row above is never chosen. [switchesY] are the switches' middles. */
    const val NEAR = 60
    fun pickSwitch(titleY: Int, switchesY: List<Int>): Int? {
        val best = switchesY.withIndex().minByOrNull { kotlin.math.abs(it.value - titleY) } ?: return null
        return if (kotlin.math.abs(best.value - titleY) <= NEAR) best.index else null
    }
}

/** Sets the agent status to OPEN before a Cash In or B2B: presses the sheet's "পরিবর্তন করুন" once, then checks the
 *  side menu and flips the status switch if it still reads বন্ধ, at most twice. DONE only when the side menu itself
 *  reads খোলা. Nothing here moves money; a failure stops the run before anything is sent. */
internal class AgentOpener(private val note: (String) -> Unit) {
    enum class Result { WORKING, DONE, FAILED }
    var active = false; private set
    private var startedAt = 0L
    private var nextAt = 0L
    private var proceeded = false
    private var sheetCloses = 0
    private var drawerOpens = 0
    private var switchTaps = 0
    private var tappedAt = 0L

    fun start(now: Long) {
        active = true; startedAt = now; nextAt = now
        proceeded = false; sheetCloses = 0; drawerOpens = 0; switchTaps = 0; tappedAt = 0
    }

    private fun idEnds(n: AccessibilityNodeInfo, id: String) = (n.viewIdResourceName ?: "").endsWith(id)
    private fun press(svc: AccessibilityService, n: AccessibilityNodeInfo): Boolean =
        AppReader.tap(svc, n) || n.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    private fun midY(n: AccessibilityNodeInfo): Int { val r = Rect(); n.getBoundsInScreen(r); return r.centerY() }

    fun step(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>, texts: List<String>, now: Long, settle: Long): Result {
        if (!active) return Result.DONE
        if (now - startedAt > LIMIT_MS) { note("the agent status could not be set to OPEN in time"); active = false; return Result.FAILED }
        if (now < nextAt) return Result.WORKING
        val status = AgentStatusRead.drawerStatus(texts)
        when {
            AppBanners.agentStatus(texts) -> {
                if (!proceeded) {
                    proceeded = true
                    val b = nodes.firstOrNull { idEnds(it, "tag_proceed_button") }
                    if (b != null && press(svc, b)) note("bKash says the agent status is CLOSE: pressing পরিবর্তন করুন to open it")
                    else if (AppReader.pressAny(svc, setOf("পরিবর্তন করুন", "change now"))) note("bKash says the agent status is CLOSE: pressing পরিবর্তন করুন")
                    else { note("the পরিবর্তন করুন button was not found, closing the sheet and using the side menu"); closeSheet(svc, nodes) }
                } else {
                    if (++sheetCloses > 2) { note("bKash keeps showing the status sheet"); active = false; return Result.FAILED }
                    note("the status sheet is still there: closing it and using the side menu")
                    closeSheet(svc, nodes)
                }
                nextAt = now + settle
            }
            status == true -> {
                note("the side menu says the agent status is খোলা (OPEN); closing the menu")
                val c = nodes.firstOrNull { idEnds(it, "tag_drawer_header_close_icon") }
                if (c == null || !press(svc, c)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                active = false
                return Result.DONE
            }
            status == false -> {
                if (switchTaps < 2 && (tappedAt == 0L || now - tappedAt > 5_000)) {
                    val title = nodes.firstOrNull { it.text?.toString()?.trim()?.let { x -> x == AgentStatusRead.TITLE || x.equals("agent status", ignoreCase = true) } == true }
                    val switches = nodes.filter { idEnds(it, "tag_labeled_switch") }
                    val i = if (title == null) null else AgentStatusRead.pickSwitch(midY(title), switches.map { midY(it) })
                    if (i == null) { note("the agent status switch was not found"); active = false; return Result.FAILED }
                    switchTaps++; tappedAt = now
                    note("the side menu says the agent status is বন্ধ: switching it on ($switchTaps)")
                    press(svc, switches[i])
                    nextAt = now + settle
                } else if (switchTaps >= 2 && now - tappedAt > 6_000) {
                    note("the agent status stayed বন্ধ after two taps"); active = false; return Result.FAILED
                }
            }
            else -> {
                // Home or another page: open the side menu to check (or set) the status.
                if (drawerOpens < 3) {
                    val d = nodes.firstOrNull { idEnds(it, "tag_drawer_icon") || idEnds(it, "tag_toolbar_open_drawer") }
                    if (d != null) {
                        drawerOpens++
                        note("opening bKash's side menu to check the agent status")
                        press(svc, d)
                        nextAt = now + settle
                    }
                }
            }
        }
        return Result.WORKING
    }

    private fun closeSheet(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>) {
        if (!AppReader.closeAgentStatus(svc, nodes)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }

    companion object { const val LIMIT_MS = 40_000L }
}
