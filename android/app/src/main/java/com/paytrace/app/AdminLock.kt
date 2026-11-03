package com.paytrace.app

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** The ADMIN CODE: a number only the owner knows, that guards the settings which must not be changed by whoever happens
 *  to be holding the phone (owner request 2026-11-03: "some settings should be admin only ... so that this important
 *  setting does not get off by mistake").
 *
 *  What it guards: letting the dashboard check balances, letting the dashboard send money from this phone, the wallet
 *  PINs and SIM choice, the test button, the extra-strong keep-alive and the server address. What it does NOT guard, and
 *  cannot: Android's own settings, uninstalling the app, or clearing its data. Clearing the data un-pairs the phone and
 *  wipes the saved wallet PINs, so that route stops payments and moves no money — the safe direction.
 *
 *  It is a DIFFERENT number from any wallet PIN, it is stored here only as a salted hash (never the number itself) and it
 *  is never sent to the dashboard or anywhere else. The pure parts (this object and [AdminThrottle]) are unit tested. */
object AdminCode {
    const val MIN_DIGITS = 6
    const val MAX_DIGITS = 12
    private const val ITERATIONS = 120_000
    private const val VERSION = "v1"

    /** Null when the code is acceptable, otherwise one plain sentence about what is wrong with it. */
    fun problem(code: String): String? {
        if (code.length < MIN_DIGITS) return "Use at least $MIN_DIGITS digits."
        if (code.length > MAX_DIGITS) return "Use at most $MAX_DIGITS digits."
        if (!code.all { it in '0'..'9' }) return "Use digits only."
        if (code.toSet().size == 1) return "Do not use one digit repeated."
        if (isRun(code)) return "Do not use a run of digits such as 123456."
        return null
    }

    private fun isRun(code: String): Boolean {
        val pairs = code.zipWithNext()
        return pairs.all { (a, b) -> b - a == 1 } || pairs.all { (a, b) -> a - b == 1 }
    }

    fun newSalt(): ByteArray = ByteArray(16).also { SecureRandom().nextBytes(it) }

    private fun hash(code: String, salt: ByteArray, iterations: Int): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(code.toCharArray(), salt, iterations, 256))
            .encoded

    /** What is stored: `v1:<iterations>:<salt>:<hash>`. Never the code. */
    fun encode(code: String, salt: ByteArray = newSalt(), iterations: Int = ITERATIONS): String {
        val enc = Base64.getEncoder()
        return listOf(VERSION, iterations.toString(), enc.encodeToString(salt), enc.encodeToString(hash(code, salt, iterations)))
            .joinToString(":")
    }

    /** True only when [code] is the one [stored] was made from. A damaged or unknown record never matches. */
    fun matches(code: String, stored: String): Boolean {
        return try {
            val parts = stored.split(":")
            if (parts.size != 4 || parts[0] != VERSION) return false
            val rounds = parts[1].toInt()
            if (rounds !in 1_000..1_000_000) return false
            val dec = Base64.getDecoder()
            // isEqual compares in constant time, so the time taken does not hint at how many digits were right.
            MessageDigest.isEqual(hash(code, dec.decode(parts[2]), rounds), dec.decode(parts[3]))
        } catch (e: Exception) {
            false
        }
    }
}

/** How long to refuse after wrong codes, so a six-digit code cannot simply be tried one after another. Pure. */
object AdminThrottle {
    const val TRIES = 5
    const val BASE_MS = 5 * 60_000L
    const val MAX_MS = 6 * 60 * 60_000L

    /** The wait that starts after this many wrong codes in a row: none until the 5th, then 5 minutes, then 10, 20, ... at
     *  most 6 hours. A right code starts the count again. */
    fun waitAfter(failures: Int): Long {
        if (failures < TRIES || failures % TRIES != 0) return 0L
        val round = failures / TRIES - 1
        return minOf(BASE_MS shl minOf(round, 20), MAX_MS)
    }

    fun remaining(lockedUntil: Long, now: Long): Long = maxOf(0L, lockedUntil - now)

    /** Wrong codes left before the next wait starts. */
    fun triesLeft(failures: Int): Int = TRIES - (failures % TRIES)

    fun minutes(ms: Long): Int = ((ms + 59_999L) / 60_000L).toInt().coerceAtLeast(1)
}

/** Whether the guarded settings can be changed right now, and the code check behind it. */
object AdminLock {
    /** After a right code the settings stay open this long, or until the person leaves the Settings tab. */
    const val WINDOW_MS = 5 * 60_000L
    private const val PREFS = "paytrace_admin"

    // Snapshot state, so every screen that reads it redraws the moment the lock changes.
    private var unlockedUntil by mutableLongStateOf(0L)
    private var version by mutableIntStateOf(0)

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** An admin code has been chosen on this phone. */
    fun isSet(ctx: Context): Boolean = version >= 0 && !prefs(ctx).getString("hash", null).isNullOrBlank()

    fun isUnlocked(): Boolean = SystemClock.elapsedRealtime() < unlockedUntil

    /** True when the guarded settings may be changed: no code chosen yet, or the right one was entered a moment ago. */
    fun canEdit(ctx: Context): Boolean = !isSet(ctx) || isUnlocked()

    fun lock() {
        unlockedUntil = 0L
    }

    /** Whole minutes of the open window left, for the screen. */
    fun minutesLeft(): Int = AdminThrottle.minutes((unlockedUntil - SystemClock.elapsedRealtime()).coerceAtLeast(0L))

    /** Chooses (or, when already unlocked, replaces) the admin code. Null when it worked, otherwise the reason. */
    fun setCode(ctx: Context, code: String, again: String): String? {
        if (isSet(ctx) && !isUnlocked()) return "Unlock first."
        AdminCode.problem(code)?.let { return it }
        if (code != again) return "The two codes are not the same."
        prefs(ctx).edit().putString("hash", AdminCode.encode(code)).putInt("fails", 0).putLong("until", 0L).apply()
        version++
        unlockedUntil = SystemClock.elapsedRealtime() + WINDOW_MS
        return null
    }

    sealed class Attempt {
        object Opened : Attempt()
        data class Wrong(val triesLeft: Int, val waitMs: Long) : Attempt()
        data class Wait(val ms: Long) : Attempt()
    }

    fun tryUnlock(ctx: Context, code: String, now: Long = System.currentTimeMillis()): Attempt {
        val p = prefs(ctx)
        val stored = p.getString("hash", null) ?: return Attempt.Opened
        val wait = AdminThrottle.remaining(p.getLong("until", 0L), now)
        if (wait > 0L) return Attempt.Wait(wait)
        if (AdminCode.matches(code, stored)) {
            p.edit().putInt("fails", 0).putLong("until", 0L).apply()
            unlockedUntil = SystemClock.elapsedRealtime() + WINDOW_MS
            return Attempt.Opened
        }
        val fails = p.getInt("fails", 0) + 1
        val hold = AdminThrottle.waitAfter(fails)
        p.edit().putInt("fails", fails).putLong("until", if (hold > 0L) now + hold else 0L).apply()
        return Attempt.Wrong(AdminThrottle.triesLeft(fails), hold)
    }
}

/** The card at the top of Settings: choose the admin code, unlock with it, lock again, change it. [tick] lets the
 *  "open for N more minutes" line and the automatic re-lock show up without any tap. */
@Composable
fun AdminLockCard(tick: Int) {
    val ctx = LocalContext.current
    val set = AdminLock.isSet(ctx)
    val open = AdminLock.canEdit(ctx)
    var code by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var changing by remember { mutableStateOf(false) }
    val minutes = remember(tick, open) { AdminLock.minutesLeft() }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                !set -> {
                    Text("Protect the important settings", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Right now anyone holding this phone can switch off balance checks, switch on sending money, change a wallet PIN " +
                            "or change the server address. Choose an admin code and only the owner can change those. It is not a wallet " +
                            "PIN, it stays on this phone as a scrambled copy, and it is never sent to the dashboard.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    CodeFields(code, again, onCode = { code = it }, onAgain = { again = it }, askTwice = true)
                    Button(
                        enabled = code.length >= AdminCode.MIN_DIGITS && again.isNotEmpty(),
                        onClick = {
                            val problem = AdminLock.setCode(ctx, code, again)
                            message = problem ?: "Done. The settings are protected."
                            if (problem == null) { code = ""; again = "" }
                        },
                    ) { Text("Set admin code") }
                }
                !open -> {
                    Text("Important settings are locked", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Balance checks, sending money, wallet PINs, the SIM choice and the server address can only be changed by the owner. " +
                            "Enter the admin code to change them.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = code,
                        onValueChange = { v -> code = v.filter { it.isDigit() }.take(AdminCode.MAX_DIGITS) },
                        label = { Text("Admin code") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(
                        enabled = code.length >= AdminCode.MIN_DIGITS,
                        onClick = {
                            message = when (val r = AdminLock.tryUnlock(ctx, code)) {
                                is AdminLock.Attempt.Opened -> ""
                                is AdminLock.Attempt.Wait -> "Too many wrong codes. Try again in ${AdminThrottle.minutes(r.ms)} minute(s)."
                                is AdminLock.Attempt.Wrong ->
                                    if (r.waitMs > 0L) "Wrong code. Locked for ${AdminThrottle.minutes(r.waitMs)} minute(s)."
                                    else "Wrong code. ${r.triesLeft} tries left before a wait."
                            }
                            code = ""
                        },
                    ) { Text("Unlock") }
                }
                else -> {
                    Text("Important settings are unlocked", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "They lock again by themselves in about $minutes minute(s), or when you leave this screen.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { AdminLock.lock(); changing = false; message = "" }) { Text("Lock now") }
                        OutlinedButton(onClick = { changing = !changing; message = "" }) { Text(if (changing) "Cancel" else "Change admin code") }
                    }
                    if (changing) {
                        CodeFields(code, again, onCode = { code = it }, onAgain = { again = it }, askTwice = true)
                        Button(
                            enabled = code.length >= AdminCode.MIN_DIGITS && again.isNotEmpty(),
                            onClick = {
                                val problem = AdminLock.setCode(ctx, code, again)
                                message = problem ?: "The admin code was changed."
                                if (problem == null) { code = ""; again = ""; changing = false }
                            },
                        ) { Text("Save new code") }
                    }
                }
            }
            if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun CodeFields(code: String, again: String, onCode: (String) -> Unit, onAgain: (String) -> Unit, askTwice: Boolean) {
    OutlinedTextField(
        value = code,
        onValueChange = { v -> onCode(v.filter { it.isDigit() }.take(AdminCode.MAX_DIGITS)) },
        label = { Text("New admin code (${AdminCode.MIN_DIGITS}-${AdminCode.MAX_DIGITS} digits)") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
    if (askTwice) OutlinedTextField(
        value = again,
        onValueChange = { v -> onAgain(v.filter { it.isDigit() }.take(AdminCode.MAX_DIGITS)) },
        label = { Text("Type it again") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
}
