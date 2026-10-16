package com.paytrace.app

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest
import java.util.Calendar

data class LogRow(
    val id: Long,
    val provider: String,
    val sender: String,
    val body: String,
    val trxId: String?,
    val amount: Double?,
    val fee: Double?,
    val commission: Double?,
    val balance: Double?,
    val payer: String?,
    val datetime: String?,
    val cashOut: Boolean,
    val status: String, // PENDING | SENT | FAILED
    val attempts: Int,
    val error: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

data class Stats(
    val receivedTotal: Double,
    val cashOutTotal: Double,
    val sent: Int,
    val failed: Int,
    val pending: Int,
)

class Db private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "paytrace.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "create table logs(" +
                "id integer primary key autoincrement," +
                "provider text not null, sender text not null, body text not null," +
                "dedupe text not null unique," +
                "trx_id text, amount real, fee real, commission real, balance real," +
                "payer text, datetime text, cash_out integer not null default 0," +
                "status text not null, attempts integer not null default 0, error text," +
                "created_at integer not null, updated_at integer not null)"
        )
        db.execSQL("create index logs_status on logs(status, created_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    private fun Cursor.str(c: String): String? {
        val i = getColumnIndexOrThrow(c)
        return if (isNull(i)) null else getString(i)
    }

    private fun Cursor.dbl(c: String): Double? {
        val i = getColumnIndexOrThrow(c)
        return if (isNull(i)) null else getDouble(i)
    }

    private fun Cursor.lng(c: String): Long = getLong(getColumnIndexOrThrow(c))

    private fun Cursor.toRow() = LogRow(
        id = lng("id"),
        provider = str("provider") ?: "",
        sender = str("sender") ?: "",
        body = str("body") ?: "",
        trxId = str("trx_id"),
        amount = dbl("amount"),
        fee = dbl("fee"),
        commission = dbl("commission"),
        balance = dbl("balance"),
        payer = str("payer"),
        datetime = str("datetime"),
        cashOut = lng("cash_out") == 1L,
        status = str("status") ?: "PENDING",
        attempts = lng("attempts").toInt(),
        error = str("error"),
        createdAt = lng("created_at"),
        updatedAt = lng("updated_at"),
    )

    private fun sha(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** Returns the new row id, or -1 if this exact message was already stored (duplicate). */
    fun insertIfNew(provider: String, sender: String, body: String, q: Providers.Quick): Long {
        val now = System.currentTimeMillis()
        val v = ContentValues()
        v.put("provider", provider)
        v.put("sender", sender)
        v.put("body", body)
        v.put("dedupe", sha(sender + "\n" + body))
        v.put("trx_id", q.trxId)
        v.put("amount", q.amount)
        v.put("fee", q.fee)
        v.put("commission", q.commission)
        v.put("balance", q.balance)
        v.put("payer", q.payer)
        v.put("datetime", q.datetime)
        v.put("cash_out", if (q.cashOut) 1 else 0)
        v.put("status", "PENDING")
        v.put("attempts", 0)
        v.put("created_at", now)
        v.put("updated_at", now)
        return writableDatabase.insertWithOnConflict("logs", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun get(id: Long): LogRow? =
        readableDatabase.rawQuery("select * from logs where id = ?", arrayOf(id.toString())).use { c ->
            if (c.moveToFirst()) c.toRow() else null
        }

    fun list(status: String?, provider: String?, limit: Int): List<LogRow> {
        val where = ArrayList<String>()
        val args = ArrayList<String>()
        if (status != null) { where.add("status = ?"); args.add(status) }
        if (provider != null) { where.add("provider = ?"); args.add(provider) }
        val sql = "select * from logs" +
            (if (where.isEmpty()) "" else " where " + where.joinToString(" and ")) +
            " order by created_at desc limit " + limit
        readableDatabase.rawQuery(sql, args.toTypedArray()).use { c ->
            val out = ArrayList<LogRow>()
            while (c.moveToNext()) out.add(c.toRow())
            return out
        }
    }

    fun pendingIds(): List<Long> =
        readableDatabase.rawQuery("select id from logs where status = 'PENDING' order by created_at", null).use { c ->
            val out = ArrayList<Long>()
            while (c.moveToNext()) out.add(c.getLong(0))
            out
        }

    fun mark(id: Long, status: String, attempts: Int, error: String?) {
        val v = ContentValues()
        v.put("status", status)
        v.put("attempts", attempts)
        v.put("error", error)
        v.put("updated_at", System.currentTimeMillis())
        writableDatabase.update("logs", v, "id = ?", arrayOf(id.toString()))
    }

    /** Manual retry: back to PENDING with a fresh attempt count. */
    fun resetForRetry(id: Long) = mark(id, "PENDING", 0, null)

    /** Manual "mark success" for a message you've handled some other way. */
    fun markSuccess(id: Long) {
        val row = get(id) ?: return
        mark(id, "SENT", row.attempts, "marked manually")
    }

    fun todayStats(): Stats {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        val sql = "select " +
            "coalesce(sum(case when cash_out = 0 then amount end), 0), " +
            "coalesce(sum(case when cash_out = 1 then amount end), 0), " +
            "coalesce(sum(case when status = 'SENT' then 1 else 0 end), 0), " +
            "coalesce(sum(case when status = 'FAILED' then 1 else 0 end), 0), " +
            "coalesce(sum(case when status = 'PENDING' then 1 else 0 end), 0) " +
            "from logs where created_at >= ?"
        readableDatabase.rawQuery(sql, arrayOf(cal.timeInMillis.toString())).use { c ->
            c.moveToFirst()
            return Stats(c.getDouble(0), c.getDouble(1), c.getInt(2), c.getInt(3), c.getInt(4))
        }
    }

    companion object {
        @Volatile private var inst: Db? = null
        fun get(ctx: Context): Db =
            inst ?: synchronized(this) { inst ?: Db(ctx.applicationContext).also { inst = it } }
    }
}
