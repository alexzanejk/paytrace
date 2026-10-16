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
