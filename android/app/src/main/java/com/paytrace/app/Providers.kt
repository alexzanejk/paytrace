package com.paytrace.app

/** Which SMS sender IDs belong to which provider, plus a light on-device read of the message for display only.
 *  The server re-reads the raw SMS itself and is the source of truth. */
object Providers {
    val ALL = listOf("BKASH", "NAGAD", "ROCKET", "UPAY")
    val LABEL = mapOf("BKASH" to "bKash", "NAGAD" to "Nagad", "ROCKET" to "Rocket", "UPAY" to "Upay")

    private val SENDERS = mapOf(
        "bkash" to "BKASH",
        "nagad" to "NAGAD",
        "16216" to "ROCKET",
        "upay" to "UPAY",
    )

    fun fromSender(sender: String?): String? = SENDERS[sender?.trim()?.lowercase()]

    data class Quick(
        val trxId: String?,
        val amount: Double?,
        val fee: Double?,
        val commission: Double?,
        val balance: Double?,
        val payer: String?,
        val datetime: String?,
        val cashOut: Boolean,
    )

    private val I = RegexOption.IGNORE_CASE
    private const val MONEY = "Tk\\.?\\s*([\\d,]+(?:\\.\\d+)?)"

    private fun num(s: String?): Double? = s?.replace(",", "")?.toDoubleOrNull()
    private fun find(body: String, re: String): String? = Regex(re, I).find(body)?.groupValues?.get(1)

    fun quick(body: String): Quick {
        val amount = num(
            find(body, "Amount\\s*:\\s*" + MONEY)
                ?: find(body, "(?:Cash\\s*Out|received(?:\\s+payment)?|sent|payment)\\s+" + MONEY)
                ?: find(body, MONEY)
        )
        return Quick(
            trxId = find(body, "(?:Trx\\s?ID|Txn\\s?ID|TID)\\s*[:\\-]?\\s*([A-Za-z0-9]{6,})")?.uppercase(),
            amount = amount,
            fee = num(find(body, "Fee\\s*[:\\-]?\\s*" + MONEY)),
            commission = num(find(body, "Comm(?:ission)?\\s*[:\\-]?\\s*" + MONEY)),
            balance = num(find(body, "Balance\\s*[:\\-]?\\s*" + MONEY)),
            payer = find(body, "(?:from|Customer|Sender)\\s*[:\\-]?\\s*([0-9Xx*+]{7,})"),
            datetime = find(body, "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}[,\\s]+\\d{1,2}:\\d{2}(?::\\d{2})?)"),
            cashOut = Regex("cash\\s*out", I).containsMatchIn(body),
        )
    }
}
