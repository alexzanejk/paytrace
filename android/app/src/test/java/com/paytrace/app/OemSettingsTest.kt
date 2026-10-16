package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OemSettingsTest {
    private fun classes(m: String) = OemSettings.candidates(m).map { it.cls }

    @Test fun vivoOpensItsBackgroundStartupManager() =
        assertEquals("com.vivo.permissionmanager.activity.BgStartUpManagerActivity", classes("vivo").first())

    @Test fun iqooIsTreatedLikeVivo() = assertEquals(classes("vivo"), classes("iQOO"))

    @Test fun oneplusOpensItsChainLaunchPageFirst() =
        assertEquals("com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity", classes("OnePlus").first())

    @Test fun oppoAndRealmeUseColorOsStartupList() {
        assertTrue(classes("OPPO").first().contains("StartupAppListActivity"))
        assertEquals(classes("oppo"), classes("realme"))
    }

    @Test fun xiaomiFamilyOpensTheAutostartManager() {
        val expected = "com.miui.permcenter.autostart.AutoStartManagementActivity"
        for (m in listOf("Xiaomi", "Redmi", "POCO")) assertEquals(expected, classes(m).first())
    }

    @Test fun samsungOpensItsBatteryPage() = assertTrue(classes("samsung").first().contains("BatteryActivity"))

    @Test fun huaweiAndHonorOpenTheStartupManager() = assertEquals(classes("huawei"), classes("HONOR"))

    @Test fun tecnoInfinixAndItelUseTheTranssionPhoneManager() {
        for (m in listOf("TECNO", "Infinix", "itel", "Transsion")) {
            assertTrue("pages for $m", classes(m).any { it.contains("AutoStart") })
        }
    }

    @Test fun everyTargetNamesAPackageAndAClass() {
        for (m in listOf("vivo", "oneplus", "oppo", "xiaomi", "huawei", "samsung", "tecno", "asus")) {
            for (t in OemSettings.candidates(m)) {
                assertTrue("${t.pkg} / ${t.cls}", t.pkg.contains('.') && t.cls.contains('.'))
            }
        }
    }

    @Test fun anUnknownMakerHasNoVendorPageSoTheCallerFallsBack() {
        assertTrue(OemSettings.candidates("Google").isEmpty())
        assertTrue(OemSettings.candidates(null).isEmpty())
        assertTrue(OemSettings.candidates("").isEmpty())
    }
}
