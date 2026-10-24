package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GuideTextTest {
    private val makers = listOf("vivo", "iqoo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "poco", "huawei", "honor", "samsung", "tecno", "infinix", "itel", "asus", "Google")

    private fun hasBangla(s: String?) = s != null && s.any { it in 'ঀ'..'৿' }

    /** The English menu and option names that must survive in the Bangla, because the phone's own screens are usually in English. */
    private val keep: Map<String, List<String>> = mapOf(
        "vivo_bg" to listOf("Allow high background power consumption", "Optimized", "Background power consumption management"),
        "vivo_autostart" to listOf("Autostart"),
        "vivo_saver" to listOf("Super power saving", "Ultra power saving", "OFF"),
        "op_battery" to listOf("Don't optimize", "Optimize", "Battery optimization"),
        "op_bg" to listOf("Allow background activity", "Allow auto-launch", "ON"),
        "op_sleep" to listOf("Sleep standby optimization", "Deep optimization", "OFF"),
        "xi_autostart" to listOf("Autostart", "ON"),
        "xi_saver" to listOf("No restrictions", "Restricted", "Battery saver"),
        "sa_never" to listOf("Never sleeping apps", "Sleeping apps", "Deep sleeping apps"),
        "sa_unused" to listOf("Put unused apps to sleep", "OFF"),
        "tr_auto" to listOf("Autostart manager", "ON"),
        "tr_batt" to listOf("No restrictions", "Don't optimise", "Optimised"),
        "tr_power" to listOf("Allow", "Always run", "App power management"),
        "hu_launch" to listOf("Manage manually", "Auto-launch", "Secondary launch", "Run in background", "Automatic"),
        "gen_batt" to listOf("No restrictions", "Don't optimize", "Optimized", "Restricted"),
        "gen_auto" to listOf("Autostart", "Auto-launch", "Background activity"),
        "lock" to emptyList(),
    )

    @Test fun everyStepOfEveryBrandHasCompleteBangla() {
        for (m in makers) for (step in Setup.guide(m)) {
            val bn = GuideText.BANGLA[step.id]
            assertNotNull("Bangla for ${step.id} ($m)", bn)
            bn!!
            assertTrue("${step.id}.title is Bangla", hasBangla(bn.title))
            assertTrue("${step.id}.why is Bangla", hasBangla(bn.why))
            // The option to tap may be only the quoted English name: the screen puts a Bangla "choose:" label in front of it.
            assertTrue("${step.id}.choose is Bangla or a quoted option", hasBangla(bn.choose) || bn.choose.contains('"'))
            for ((name, text) in listOf("title" to bn.title, "path" to bn.path, "choose" to bn.choose, "why" to bn.why)) {
                assertTrue("${step.id}.$name is not blank", text.isNotBlank())
                assertTrue("${step.id}.$name has no leftover placeholders", !text.contains('$') && !text.contains('{'))
            }
            assertEquals("avoid is present exactly when the English has one: ${step.id}", step.avoid != null, bn.avoid != null)
            if (bn.avoid != null) assertTrue("${step.id}.avoid is Bangla or a quoted option", hasBangla(bn.avoid) || bn.avoid.contains('"'))
        }
    }

    @Test fun bengaliTextIsReallyUsedForTheTitleChooseAndWhy() {
        for (step in Setup.guide("vivo") + Setup.guide("xiaomi") + Setup.guide("samsung")) {
            val bn = GuideText.step(step, Lang.BN)
            assertTrue("${step.id} title", hasBangla(bn.title))
            assertTrue("${step.id} why", hasBangla(bn.why))
        }
    }

    @Test fun theEnglishOptionNamesStayInTheBangla() {
        for (m in makers) for (step in Setup.guide(m)) {
            val bn = GuideText.step(step, Lang.BN)
            val all = listOf(bn.title, bn.path, bn.choose, bn.avoid ?: "").joinToString("\n")
            for (label in keep.getValue(step.id)) assertTrue("${step.id}: \"$label\" must stay in English", all.contains(label))
        }
    }

    @Test fun theMenuPathKeepsTheEnglishMenuNames() {
        for (m in makers) for (step in Setup.guide(m)) {
            if (step.id == "lock") continue
            val menu = step.path.substringBefore(" (").trim()
            assertTrue("${step.id}: path keeps \"$menu\"", GuideText.step(step, Lang.BN).path.contains(menu))
        }
    }

    @Test fun englishIsUnchanged() {
        for (m in makers) for (step in Setup.guide(m)) {
            val en = GuideText.step(step, Lang.EN)
            assertEquals(step.title, en.title)
            assertEquals(step.path, en.path)
            assertEquals(step.choose, en.choose)
            assertEquals(step.avoid, en.avoid)
            assertEquals(step.why, en.why)
        }
    }

    @Test fun everyPageTheGuideCanOpenHasABanglaName() {
        for (m in makers) for (step in Setup.guide(m)) for (w in SettingsWays.forStep(step.id, m)) {
            assertTrue("Bangla name for ${w.id}", hasBangla(GuideText.wayLabelBn(w.id)))
            assertTrue(hasBangla(GuideText.wayLabel(w, Lang.BN)))
            assertEquals(w.label, GuideText.wayLabel(w, Lang.EN))
        }
    }

    @Test fun everyFixedLineOfTheScreenIsInBangla() {
        for (t in GuideText.allScreenTexts(Lang.BN)) assertTrue("Bangla: $t", hasBangla(t))
        for (t in GuideText.allScreenTexts(Lang.EN)) assertFalse("English: $t", hasBangla(t))
    }

    @Test fun theProgressLineCountsRight() {
        assertTrue(GuideText.progress(Lang.BN, 2, 5).contains("5") && GuideText.progress(Lang.BN, 2, 5).contains("2"))
        assertEquals("2 of 5 settings done", GuideText.progress(Lang.EN, 2, 5))
        assertEquals("All 4 settings are done. Thank you.", GuideText.progress(Lang.EN, 4, 4))
    }

    @Test fun testCardTextsCarryTheirNumbers() {
        assertTrue(GuideText.testPass(Lang.BN, "", 10, 31).contains("31"))
        assertTrue(GuideText.testFail(Lang.BN, "Fri 23 Oct, 3:05 PM", 240).contains("240"))
        assertTrue(GuideText.testFail(Lang.BN, "Fri 23 Oct, 3:05 PM", 240).contains("Fri 23 Oct, 3:05 PM"))
        assertTrue(GuideText.testRunning(Lang.BN, 7).contains("7"))
        assertTrue(GuideText.testShort(Lang.BN, 3).contains("3"))
    }

    @Test fun phoneCheckLinesAreInBothLanguages() {
        val lines = listOf(5, 10, 20, 30, 40, 45, 50, null).map { PhoneCheck.bucketLine(it) } +
            listOf(true, false).map { PhoneCheck.batteryLine(it) } + listOf(true, false, null).map { PhoneCheck.restrictedLine(it) }
        for (l in lines) {
            assertTrue("title bn: ${l.title}", hasBangla(l.title(Lang.BN)))
            assertTrue("answer bn: ${l.answer}", hasBangla(l.answer(Lang.BN)))
            assertFalse(hasBangla(l.title(Lang.EN)))
            assertFalse(hasBangla(l.answer(Lang.EN)))
        }
    }

    @Test fun theLanguageDefaultsToBangla() {
        assertEquals(Lang.BN, Lang.of(null))
        assertEquals(Lang.BN, Lang.of("bn"))
        assertEquals(Lang.BN, Lang.of("anything else"))
        assertEquals(Lang.EN, Lang.of("en"))
        assertEquals("bn", Lang.BN.code)
    }
}
