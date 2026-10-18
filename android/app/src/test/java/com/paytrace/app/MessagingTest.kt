package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagingTest {
    private fun row(id: Long, thread: Long, address: String, date: Long, type: Int = SmsRow.TYPE_INBOX, read: Boolean = true, body: String = "hi", status: Int = -1) =
        SmsRow(id, thread, address, body, date, type, read, status)

    // ---- conversations ----

    @Test fun messagesOfOneThreadFormOneConversationNewestFirst() {
        val out = ThreadGrouping.group(listOf(row(1, 5, "017", 100), row(2, 9, "018", 300), row(3, 5, "017", 200, body = "newest of 017")))
        assertEquals(listOf(9L, 5L), out.map { it.threadId })
        assertEquals("newest of 017", out[1].lastBody)
        assertEquals(2, out[1].count)
    }

    @Test fun onlyUnseenIncomingMessagesCountAsNew() {
        val out = ThreadGrouping.group(
            listOf(
                row(1, 5, "017", 100, read = false),
                row(2, 5, "017", 110, read = false),
                row(3, 5, "017", 120, type = SmsRow.TYPE_SENT, read = false), // something we sent is never "new"
                row(4, 5, "017", 130, read = true),
            ),
        )
        assertEquals(2, out.single().unread)
    }

    @Test fun messagesWithoutAThreadAreGroupedByNumber() {
        val out = ThreadGrouping.group(listOf(row(1, 0, "bKash", 100), row(2, 0, "bKash", 200), row(3, 0, "Nagad", 150)))
        assertEquals(2, out.size)
        assertEquals("bKash", out.first().address)
        assertEquals(2, out.first().count)
    }

    @Test fun noMessagesNoConversations() = assertTrue(ThreadGrouping.group(emptyList()).isEmpty())

    // ---- phone numbers ----

    @Test fun aBangladeshNumberIsTidied() {
        assertEquals("01712345678", PhoneNumber.clean(" 01712-345 678 "))
        assertEquals("+8801712345678", PhoneNumber.clean("+880 1712 345678"))
    }

    @Test fun bracketsAndDotsAreRemoved() = assertEquals("+8801712345678", PhoneNumber.clean("+(880) 1712.345678"))

    @Test fun shortCodesAreAllowed() = assertEquals("16216", PhoneNumber.clean("16216"))

    @Test fun sendersWithNamesCannotBeRepliedTo() {
        assertNull(PhoneNumber.clean("bKash"))
        assertNull(PhoneNumber.clean("NAGAD"))
        assertFalse(PhoneNumber.canReplyTo("bKash"))
        assertTrue(PhoneNumber.canReplyTo("01712345678"))
    }

    @Test fun emptyTooShortAndTooLongAreRefused() {
        assertNull(PhoneNumber.clean(""))
        assertNull(PhoneNumber.clean(null))
        assertNull(PhoneNumber.clean("12"))
        assertNull(PhoneNumber.clean("1".repeat(16)))
    }

    // ---- message text ----

    @Test fun aShortMessageIsOnePart() = assertEquals(1, MessageText.parts("Your order is ready"))

    @Test fun aLongPlainMessageSplitsAt153() {
        assertEquals(1, MessageText.parts("a".repeat(160)))
        assertEquals(2, MessageText.parts("a".repeat(161)))
        assertEquals(2, MessageText.parts("a".repeat(306)))
        assertEquals(3, MessageText.parts("a".repeat(307)))
    }

    @Test fun banglaTextHasShorterParts() {
        assertEquals(1, MessageText.parts("আ".repeat(70)))
        assertEquals(2, MessageText.parts("আ".repeat(71)))
    }

    @Test fun anEmptyMessageIsNoParts() = assertEquals(0, MessageText.parts(""))

    @Test fun previewsAreOneLineAndShortened() {
        assertEquals("a b c", MessageText.preview("a\n\nb   c"))
        val p = MessageText.preview("x".repeat(200), 20)
        assertEquals(20, p.length)
        assertTrue(p.endsWith("…"))
    }

    // ---- message state ----

    @Test fun failedAndSendingMessagesAreRecognised() {
        assertTrue(row(1, 1, "a", 1, type = SmsRow.TYPE_FAILED).failed)
        assertTrue(row(1, 1, "a", 1, type = SmsRow.TYPE_SENT, status = SmsRow.STATUS_FAILED).failed)
        assertTrue(row(1, 1, "a", 1, type = SmsRow.TYPE_OUTBOX).sending)
        assertFalse(row(1, 1, "a", 1, type = SmsRow.TYPE_SENT).failed)
        assertTrue(row(1, 1, "a", 1).incoming)
    }
}
