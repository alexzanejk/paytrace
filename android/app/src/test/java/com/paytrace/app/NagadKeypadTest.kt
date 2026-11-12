package com.paytrace.app

import com.paytrace.app.NagadKeypad.Box
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** From the owner's two photos of Nagad's PIN keypad (2026-11-12, a Xiaomi and a Vivo): the same 3 x 4 keypad. */
class NagadKeypadTest {
    private fun near(want: Pair<Int, Int>, got: Pair<Int, Int>?, by: Int = 20) {
        requireNotNull(got)
        assertTrue("$got not near $want", abs(want.first - got.first) <= by && abs(want.second - got.second) <= by)
    }

    @Test fun everyKeyLandsOnItsLabelInBothPhotos() {
        // Photo of the Vivo: the panel spans x 245..860, y 1020..1405 in the picture; label centres measured by eye.
        val vivo = Box(245, 1020, 860, 1405)
        val v = mapOf('1' to (338 to 1070), '2' to (545 to 1070), '3' to (755 to 1070), '4' to (340 to 1167),
            '5' to (547 to 1168), '6' to (755 to 1168), '7' to (340 to 1263), '8' to (547 to 1265), '9' to (757 to 1265),
            '0' to (547 to 1362), 'D' to (343 to 1357))
        for ((k, p) in v) near(p, NagadKeypad.keyPoint(vivo, k))
        // Photo of the Xiaomi: x 255..890, y 1050..1445.
        val xiaomi = Box(255, 1050, 890, 1445)
        val x = mapOf('1' to (350 to 1110), '2' to (560 to 1105), '3' to (770 to 1100), '4' to (355 to 1205),
            '5' to (563 to 1203), '6' to (775 to 1198), '7' to (355 to 1300), '8' to (565 to 1300), '9' to (778 to 1295),
            '0' to (568 to 1397), 'D' to (360 to 1397))
        for ((k, p) in x) near(p, NagadKeypad.keyPoint(xiaomi, k))
    }

    @Test fun doneIsNeverPressedAndOtherCharactersHaveNoKey() {
        val b = Box(0, 1555, 1080, 2265)
        assertNull(NagadKeypad.keyPoint(b, 'K'))
        assertNull(NagadKeypad.keyPoint(b, 'a'))
        assertNull(NagadKeypad.keyPoint(b, '#'))
    }

    @Test fun aWiggleStaysInsideTheMiddleOfTheCell() {
        val b = Box(0, 1555, 1080, 2265)   // a 1080 x 2400 phone, panel as tall as in the photos
        assertEquals(540 to 1821, NagadKeypad.keyPoint(b, '5'))
        val far = NagadKeypad.keyPoint(b, '5', 5.0, -5.0)!!   // clamped to a tenth of the cell
        assertTrue(abs(far.first - 540) <= 36 && abs(far.second - 1821) <= 18)
    }

    @Test fun onlyAPanelShapedLikeTheKeypadIsAccepted() {
        val w = 1080; val h = 2400
        assertTrue(NagadKeypad.plausible(Box(0, 1555, 1080, 2265), w, h, 1400))
        assertFalse("half the width", NagadKeypad.plausible(Box(0, 1555, 540, 2265), w, h, 1400))
        assertFalse("above the sign-in button", NagadKeypad.plausible(Box(0, 1555, 1080, 2265), w, h, 1600))
        assertFalse("the navigation bar", NagadKeypad.plausible(Box(0, 2265, 1080, 2400), w, h, 0))
        assertFalse("the whole screen", NagadKeypad.plausible(Box(0, 0, 1080, 2400), w, h, 0))
        assertFalse("too high up", NagadKeypad.plausible(Box(0, 700, 1080, 1400), w, h, 0))
    }

    @Test fun thePanelIsFoundAsAWindowOrAsTheSpaceUnderThePage() {
        val w = 1080; val h = 2400
        val nav = Box(0, 2265, 1080, 2400)
        // a window of its own
        assertEquals(Box(0, 1555, 1080, 2265), NagadKeypad.find(listOf(nav, Box(0, 1555, 1080, 2265)), Box(0, 0, 1080, 2400), 2265, w, h, 1400))
        // no window: the page was pushed up, the panel is what is left above the navigation bar
        assertEquals(Box(0, 1555, 1080, 2265), NagadKeypad.find(listOf(nav), Box(0, 0, 1080, 1555), 2265, w, h, 1400))
        // the page fills the screen and no window fits: nothing is tapped
        assertNull(NagadKeypad.find(listOf(nav), Box(0, 0, 1080, 2400), 2265, w, h, 1400))
        assertNull(NagadKeypad.find(emptyList(), null, null, w, h, 0))
    }

    @Test fun aPanelThatMovesStopsTheTapping() {
        val a = Box(0, 1555, 1080, 2265)
        assertFalse(NagadKeypad.moved(a, Box(0, 1560, 1080, 2265)))
        assertTrue(NagadKeypad.moved(a, Box(0, 1300, 1080, 2265)))
    }

    @Test fun theVivosKeypadWindowStopsAtTheNavigationBar() {
        // Real run 2026-11-12 (Vivo V2120, 720x1600): Nagad's keypad window 0,1073,720,1600 under the system bar from
        // 1521. Tapping by the window's own size put the bottom row (DEL) on the bar's Back button.
        val win = Box(0, 1073, 720, 1600)
        val bar = Box(0, 1521, 720, 1600)
        val pad = NagadKeypad.find(listOf(win), Box(0, 0, 720, 1600), 1521, 720, 1600, 1000)!!
        assertEquals(Box(0, 1073, 720, 1521), pad)
        for (k in "0123456789D") {
            val (x, y) = NagadKeypad.keyPoint(pad, k, 1.0, 1.0)!!
            assertFalse("$k lands on the bar", NagadKeypad.blocked(x, y, listOf(bar)))
        }
        // the old, unclipped box would have put DEL on the bar: that is what the guard refuses
        val (x, y) = NagadKeypad.keyPoint(win, 'D')!!
        assertTrue(NagadKeypad.blocked(x, y, listOf(bar)))
    }

    @Test fun aWindowAboveTheBarIsLeftAsItIs() {
        assertEquals(Box(0, 1555, 1080, 2265), NagadKeypad.clip(Box(0, 1555, 1080, 2265), 2265))
        assertEquals(Box(0, 1555, 1080, 2265), NagadKeypad.clip(Box(0, 1555, 1080, 2265), null))
    }
}
