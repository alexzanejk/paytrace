package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.io.BufferedReader
import java.io.InputStreamReader

/** Reading a wallet's answer out of the phone's own radio log.
 *
 *  WHY: proved on the owner's Redmi (2026-11-02). Nagad answers the direct request with the balance, but because the answer
 *  ends with "0. Main Menu" the network keeps the menu open, and Android passes an app only the answers that close it: the
 *  app is told "failure code -1" and never sees the words. The words are in the phone's radio log all the same. A phone that
 *  has been given READ_LOGS once (over adb, like the Accessibility permission) can read them itself.
 *
 *  Pure, so the reading is unit tested against the real lines from that phone. Two shapes are seen: the plain words, and the
 *  same words as UCS2 (four hex digits per letter), which is how the MediaTek radio writes them. */
object UssdLogRead {
    private val HEX = Regex("""([0-9A-Fa-f]{16,})""")

    /** Four hex digits per letter. Returns "" for anything that is not a readable line, so junk cannot reach the parser. */
    fun decodeUcs2(hex: String): String {
        if (hex.length < 8 || hex.length % 4 != 0) return ""
        val out = StringBuilder(hex.length / 4)
        for (i in hex.indices step 4) {
            val c = hex.substring(i, i + 4).toIntOrNull(16) ?: return ""
            if (c != 10 && c != 13 && (c < 32 || c > 0x24F)) return ""
            out.append(c.toChar())
        }
        return out.toString()
    }

    /** Everything readable on one log line: the line itself, and any UCS2 run on it turned back into words. */
    fun textsIn(line: String): List<String> {
        val out = ArrayList<String>(2)
        out.add(line)
        for (m in HEX.findAll(line)) {
            val t = decodeUcs2(m.groupValues[1])
            if (t.isNotBlank()) out.add(t)
        }
        return out
    }

    /** The NEWEST balance in these lines (oldest first, as logcat prints them), or null. [balanceOf] is the wallet's own
     *  reader, so a line that is not that wallet's answer is never taken for one. */
    fun balanceIn(lines: List<String>, balanceOf: (String) -> Double?): Double? {
        var found: Double? = null
        for (line in lines) for (text in textsIn(line)) balanceOf(text)?.let { found = it }
        return found
    }
}

/** Running the phone's own `logcat -b radio`. Only ever used to pick the balance out; the lines themselves are never kept,
 *  never written to the step log and never sent anywhere, because the dialled code (PIN included) is on them too. */
object UssdLogs {
    private const val READ_MS = 4_000L

    fun allowed(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_LOGS) == PackageManager.PERMISSION_GRANTED

    /** Empty the radio log, so an answer read afterwards can only be this run's. */
    fun clear() {
        try {
            Runtime.getRuntime().exec(arrayOf("logcat", "-b", "radio", "-c")).waitFor()
        } catch (e: Exception) {
            // Not allowed on this phone: the caller simply gets nothing back later.
        }
    }

    /** The last [max] lines of the radio log, oldest first. Empty if the phone does not allow it. */
    fun lines(max: Int = 400): List<String> {
        var p: Process? = null
        return try {
            p = Runtime.getRuntime().exec(arrayOf("logcat", "-b", "radio", "-d", "-t", max.toString()))
            val out = ArrayList<String>(max)
            val reader = BufferedReader(InputStreamReader(p.inputStream))
            val until = System.currentTimeMillis() + READ_MS
            while (System.currentTimeMillis() < until) {
                val line = reader.readLine() ?: break
                out.add(line)
            }
            out
        } catch (e: Exception) {
            emptyList()
        } finally {
            try { p?.destroy() } catch (e: Exception) { }
        }
    }
}
