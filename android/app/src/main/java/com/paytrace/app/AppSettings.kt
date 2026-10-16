package com.paytrace.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Keeps the secret key encrypted with a key that never leaves the phone's hardware-backed keystore. */
class SecretStore(ctx: Context) {
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
        val stored = prefs.getString("v", null) ?: return ""
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
            prefs.edit().remove("v").apply()
            return
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val data = c.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("v", Base64.encodeToString(c.iv + data, Base64.NO_WRAP)).apply()
    }
}

class AppSettings(ctx: Context) {
    private val p: SharedPreferences = ctx.applicationContext.getSharedPreferences("paytrace", Context.MODE_PRIVATE)
    private val store = SecretStore(ctx.applicationContext)

    var serverUrl: String
        get() = p.getString("url", "") ?: ""
        set(v) { p.edit().putString("url", v.trim()).apply() }

    var secret: String
        get() = store.get()
        set(v) { store.set(v) }

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

    fun providerEnabled(provider: String): Boolean = p.getBoolean("prov_$provider", true)
    fun setProviderEnabled(provider: String, on: Boolean) {
        p.edit().putBoolean("prov_$provider", on).apply()
    }

    companion object {
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
