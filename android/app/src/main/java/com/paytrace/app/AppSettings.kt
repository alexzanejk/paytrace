package com.paytrace.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.os.Build
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Keeps secrets encrypted with a key that never leaves the phone's hardware-backed keystore.
 *  `slot` picks which secret: "v" is the optional shared secret, "device" is this phone's own key. */
class SecretStore(ctx: Context, private val slot: String = "v") {
    private val alias = "paytrace_secret_key"
    private val prefs: SharedPreferences = ctx.getSharedPreferences("paytrace_secret", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun get(): String {
        val stored = prefs.getString(slot, null) ?: return ""
        return try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val iv = raw.copyOfRange(0, 12)
            val data = raw.copyOfRange(12, raw.size)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(c.doFinal(data), Charsets.UTF_8)
        } catch (e: Exception) {
            ""
        }
    }

    fun set(value: String) {
        if (value.isEmpty()) {
            prefs.edit().remove(slot).apply()
            return
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val data = c.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(slot, Base64.encodeToString(c.iv + data, Base64.NO_WRAP)).apply()
    }
}

class AppSettings(ctx: Context) {
    private val p: SharedPreferences = ctx.applicationContext.getSharedPreferences("paytrace", Context.MODE_PRIVATE)
    private val store = SecretStore(ctx.applicationContext)
    private val deviceStore = SecretStore(ctx.applicationContext, "device")

    /** Built in, so a new phone needs no typing. Can still be changed under Settings → Advanced. */
    var serverUrl: String
        get() = p.getString("url", null)?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL
        set(v) { p.edit().putString("url", v.trim()).apply() }

    /** Optional shared secret (older setup). When empty, the phone uses its own approved device key. */
    var secret: String
        get() = store.get()
        set(v) { store.set(v) }

    /** This phone's own random key, made once on first use. Pairing sends only its hash; the server keeps only the hash. */
    val deviceKey: String
        get() {
            val existing = deviceStore.get()
            if (existing.isNotEmpty()) return existing
            val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            val key = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
            deviceStore.set(key)
            return key
        }

    /** After the dashboard removed this phone, make a fresh key so it can ask for approval again. */
    fun resetDeviceKey() {
        deviceStore.set("")
        deviceStatus = "unpaired"
    }

    val deviceKeyHash: String
        get() = MessageDigest.getInstance("SHA-256").digest(deviceKey.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    /** Same code the server and dashboard show, e.g. "3F9A-01BC". */
    val pairCode: String
        get() = deviceKeyHash.let { it.substring(0, 4).uppercase() + "-" + it.substring(4, 8).uppercase() }

    val deviceName: String
        get() = (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).take(60)

    /** Last answer from the server: "unpaired", "pending", "approved" or "revoked". */
    var deviceStatus: String
        get() = p.getString("device_status", "unpaired") ?: "unpaired"
        set(v) { p.edit().putString("device_status", v).apply() }

    val ready: Boolean
        get() = serverUrl.isNotBlank() && (secret.isNotBlank() || deviceStatus == "approved")

    /** "POST" or "GET". */
    var method: String
        get() = p.getString("method", "POST") ?: "POST"
        set(v) { p.edit().putString("method", v).apply() }

    /** Extra attempts after the first one fails. */
    var maxRetries: Int
        get() = p.getInt("retries", 3)
        set(v) { p.edit().putInt("retries", v).apply() }

    var retryMinutes: Int
        get() = p.getInt("retry_min", 15)
        set(v) { p.edit().putInt("retry_min", v).apply() }

    var monitoring: Boolean
        get() = p.getBoolean("monitoring", true)
        set(v) { p.edit().putBoolean("monitoring", v).apply() }

    var fields: Set<String>
        get() = (p.getStringSet("fields", DEFAULT_FIELDS) ?: DEFAULT_FIELDS).toSet()
        set(v) { p.edit().putStringSet("fields", v).apply() }

    /** Where the next inbox scan continues from (null = never scanned). See CatchUp.resumeFrom. */
    var inboxResumeFrom: Long?
        get() = p.getLong("inbox_resume", -1L).takeIf { it >= 0 }
        set(v) { p.edit().apply { if (v == null) remove("inbox_resume") else putLong("inbox_resume", v) }.apply() }

    /** When the inbox was last read successfully, for showing on screen. */
    var inboxCheckedAt: Long?
        get() = p.getLong("inbox_checked", -1L).takeIf { it >= 0 }
        set(v) { p.edit().apply { if (v == null) remove("inbox_checked") else putLong("inbox_checked", v) }.apply() }

    /** How many missed messages the inbox scan has picked up since the app was installed. */
    var recoveredTotal: Int
        get() = p.getInt("recovered_total", 0)
        set(v) { p.edit().putInt("recovered_total", v).apply() }

    /** The owner ticked "I did this" for the phone-brand auto-start setting, which Android does not let an app read. */
    var autostartConfirmed: Boolean
        // v2: the checklist grew (high background power use, lock in recents...), so phones confirmed under the short
        // version are asked once more.
        get() = p.getBoolean("autostart_confirmed_v2", false)
        set(v) { p.edit().putBoolean("autostart_confirmed_v2", v).apply() }

    /** Permissions the app has already asked for once. After that Android will not show the question again, so the
     *  setup screen sends the owner to the phone's app settings instead. */
    fun wasAsked(permission: String): Boolean = p.getBoolean("asked_$permission", false)
    fun markAsked(permission: String) { p.edit().putBoolean("asked_$permission", true).apply() }

    /** The one-time "make PayTrace your SMS app?" question has been shown. */
    var defaultSmsPrompted: Boolean
        get() = p.getBoolean("default_sms_prompted", false)
        set(v) { p.edit().putBoolean("default_sms_prompted", v).apply() }

    /** This phone's Firebase push address (what the server uses to wake it). Empty until Firebase hands one out. */
    var pushToken: String
        get() = p.getString("push_token", "") ?: ""
        set(v) { p.edit().putString("push_token", v).apply() }

    /** The address last included in a heartbeat, and when, so it is sent when new and then only now and then. */
    var pushSentToken: String
        get() = p.getString("push_sent_token", "") ?: ""
        set(v) { p.edit().putString("push_sent_token", v).apply() }
    var pushSentAt: Long
        get() = p.getLong("push_sent_at", 0L)
        set(v) { p.edit().putLong("push_sent_at", v).apply() }

    /** Wake-up pushes received, and when the latest arrived (shown on the Phones page, so a push that never arrives is obvious). */
    var wakeCount: Int
        get() = p.getInt("wake_count", 0)
        set(v) { p.edit().putInt("wake_count", v).apply() }
    var lastWakeAt: Long
        get() = p.getLong("last_wake_at", 0L)
        set(v) { p.edit().putLong("last_wake_at", v).apply() }

    /** Extra-strong keep-alive: a 5-minute "alarm clock" backup. Shows an alarm icon in the status bar. On by default. */
    var strongAlarm: Boolean
        get() = p.getBoolean("strong_alarm", true)
        set(v) { p.edit().putBoolean("strong_alarm", v).apply() }

    /** Uptime-clock reading (SystemClock.elapsedRealtime) of the last heartbeat attempt. 0 = none yet. */
    var lastBeatElapsed: Long
        get() = p.getLong("last_beat_elapsed", 0L)
        set(v) { p.edit().putLong("last_beat_elapsed", v).apply() }

    /** How many times the phone stopped PayTrace (a gap of 5+ minutes while the phone stayed on) since it was installed. */
    var stoppedCount: Int
        get() = p.getInt("stopped_count", 0)
        set(v) { p.edit().putInt("stopped_count", v).apply() }

    /** Length in minutes of the most recent such stop. */
    var lastGapMin: Int
        get() = p.getInt("last_gap_min", 0)
        set(v) { p.edit().putInt("last_gap_min", v).apply() }

    fun providerEnabled(provider: String): Boolean = p.getBoolean("prov_$provider", true)
    fun setProviderEnabled(provider: String, on: Boolean) {
        p.edit().putBoolean("prov_$provider", on).apply()
    }

    companion object {
        const val DEFAULT_SERVER_URL = "https://mkjcqwkfbamnuibmurcd.supabase.co/functions/v1/ingest"

        /** These two are always sent: the server needs the original text and the sender ID to verify a payment. */
        val LOCKED = setOf("raw_message", "sender_id")
        val DEFAULT_FIELDS = setOf(
            "platform", "trx_id", "amount", "sender", "fee", "commission",
            "balance", "datetime", "raw_message", "sender_id", "timestamp",
        )
        val FIELD_LABELS = listOf(
            "platform" to "Platform (BKASH / NAGAD …)",
            "trx_id" to "Transaction ID",
            "amount" to "Amount",
            "sender" to "Payer phone number",
            "fee" to "Fee",
            "commission" to "Commission",
            "balance" to "Balance",
            "datetime" to "Date and time from SMS",
            "timestamp" to "Time received on phone",
            "raw_message" to "Original SMS text (always sent)",
            "sender_id" to "SMS sender ID (always sent)",
        )
    }
}
