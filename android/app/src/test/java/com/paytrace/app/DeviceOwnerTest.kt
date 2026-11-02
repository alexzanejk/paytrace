package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The device-owner test's own safety net.
 *
 *  There is almost no logic here to test — which is the point of this change. What IS worth a test is the one line
 *  the owner will type into a terminal: a typo in it fails exactly the same way a phone refusing would, and the
 *  whole experiment exists to tell those two apart. */
class DeviceOwnerTest {
    @Test fun theAdbCommandIsSpeltRight() {
        assertEquals(
            "adb shell dpm set-device-owner com.paytrace.app/com.paytrace.app.PayTraceAdmin",
            DeviceOwner.adbCommand("com.paytrace.app"),
        )
        // The receiver named in the command must be the one the manifest declares, or the phone answers
        // "Unknown admin" and we would blame the brand for our own mistake.
        assertTrue(DeviceOwner.adbCommand("x").endsWith(PayTraceAdmin::class.java.name))
    }

    @Test fun theXiaomiTrapIsRecognisedOnEveryNameXiaomiUses() {
        assertTrue(DeviceOwner.isXiaomi("Xiaomi", "Redmi"))
        assertTrue(DeviceOwner.isXiaomi("Xiaomi", "POCO"))
        assertTrue(DeviceOwner.isXiaomi("xiaomi", "xiaomi"))
        // And not on the phones that do not have it, where the warning would only frighten.
        assertTrue(!DeviceOwner.isXiaomi("vivo", "vivo"))
        assertTrue(!DeviceOwner.isXiaomi("OnePlus", "OnePlus"))
        assertTrue(!DeviceOwner.isXiaomi("OPPO", "realme"))
    }

    @Test fun theWarningSaysTheThingThatCostsMoneyToLearnTheHardWay() {
        val w = DeviceOwner.XIAOMI_WARNING
        // It must name the setting, the account it depends on, and the state you are left in if the command fails.
        assertTrue(w.contains("USB debugging (Security settings)"))
        assertTrue(w.contains("Mi account"))
        assertTrue(w.contains("sign the Mi account back in"))
    }

    @Test fun theRequirementsLeadWithTheOneThatStopsEveryone() {
        // Accounts are what Android actually refuses on, so it is first.
        assertTrue(DeviceOwner.requirements.first().contains("Accounts"))
        assertEquals(3, DeviceOwner.requirements.size)
        assertTrue(DeviceOwner.requirements.all { it.isNotBlank() })
    }
}
