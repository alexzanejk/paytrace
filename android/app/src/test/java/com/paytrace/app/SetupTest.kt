package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupTest {
    private val allGood = Setup.State(
        smsReceive = true, smsRead = true, notifications = true, batteryExempt = true,
        autostartNeeded = false, autostartConfirmed = false,
    )

    @Test fun nothingMissingWhenEverythingIsAllowed() =
        assertTrue(Setup.missing(allGood).isEmpty())

    @Test fun aFreshInstallOnAStrictPhoneIsMissingEverything() =
        assertEquals(
            listOf(Setup.Req.SMS_RECEIVE, Setup.Req.SMS_READ, Setup.Req.NOTIFICATIONS, Setup.Req.BATTERY, Setup.Req.AUTOSTART),
            Setup.missing(Setup.State(false, false, false, false, autostartNeeded = true, autostartConfirmed = false)),
        )

    @Test fun readingOldSmsIsRequiredToo() =
        assertEquals(listOf(Setup.Req.SMS_READ), Setup.missing(allGood.copy(smsRead = false)))

    @Test fun batterySaverNotExemptedBlocksTheApp() =
        assertEquals(listOf(Setup.Req.BATTERY), Setup.missing(allGood.copy(batteryExempt = false)))

    @Test fun notificationsOffBlocksTheApp() =
        assertEquals(listOf(Setup.Req.NOTIFICATIONS), Setup.missing(allGood.copy(notifications = false)))

    @Test fun autostartIsOnlyAskedOnPhonesThatNeedIt() =
        assertTrue(Setup.missing(allGood.copy(autostartNeeded = false, autostartConfirmed = false)).isEmpty())

    @Test fun autostartIsDoneOnceConfirmed() =
        assertTrue(Setup.missing(allGood.copy(autostartNeeded = true, autostartConfirmed = true)).isEmpty())

    @Test fun autostartIsMissingUntilConfirmed() =
        assertEquals(listOf(Setup.Req.AUTOSTART), Setup.missing(allGood.copy(autostartNeeded = true, autostartConfirmed = false)))

    @Test fun theOwnersPhonesAreStrictMakers() {
        assertTrue(Setup.needsAutostartConfirm("vivo"))
        assertTrue(Setup.needsAutostartConfirm("OnePlus"))
    }

    @Test fun makerNamesAreMatchedIgnoringCaseAndSpacing() {
        assertTrue(Setup.needsAutostartConfirm("  XIAOMI "))
        assertTrue(Setup.needsAutostartConfirm("Samsung"))
    }

    @Test fun vivoStepsNameTheHighBackgroundPowerSetting() {
        val steps = Setup.brandSteps("vivo")
        assertTrue(steps.any { it.contains("high background power consumption") })
        assertTrue(steps.any { it.contains("LOCK PayTrace") })
    }

    @Test fun oneplusStepsSwitchOffSleepStandbyAndDeepOptimization() {
        val steps = Setup.brandSteps("OnePlus")
        assertTrue(steps.any { it.contains("Sleep standby optimization") && it.contains("Deep optimization") })
        assertTrue(steps.any { it.contains("Allow background activity") })
    }

    @Test fun everyStrictMakerGetsAtLeastTwoSteps() {
        for (m in listOf("vivo", "iqoo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "poco", "huawei", "honor", "samsung", "tecno", "asus")) {
            assertTrue("steps for $m", Setup.brandSteps(m).size >= 2)
        }
    }

    @Test fun tecnoAndInfinixGetTheirOwnHiOsSteps() {
        for (m in listOf("TECNO", "Infinix", "itel")) {
            val steps = Setup.brandSteps(m)
            assertTrue("autostart manager for $m", steps.any { it.contains("Autostart manager") })
            assertTrue("lock step for $m", steps.any { it.contains("LOCK PayTrace") })
        }
    }

    @Test fun anUnknownMakerStillGetsSomething() = assertTrue(Setup.brandSteps("Acme").isNotEmpty())

    @Test fun aPlainAndroidPhoneIsNotAskedForAutostart() {
        assertFalse(Setup.needsAutostartConfirm("Google"))
        assertFalse(Setup.needsAutostartConfirm(""))
        assertFalse(Setup.needsAutostartConfirm(null))
    }
}
