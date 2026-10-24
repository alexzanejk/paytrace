package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsWaysTest {
    private val makers = listOf("vivo", "iqoo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "poco", "huawei", "honor", "samsung", "tecno", "infinix", "itel", "asus", "Google")

    @Test fun everyStepOfEveryBrandHasPagesEndingInTheAppPageThenSettings() {
        for (m in makers) for (step in Setup.guide(m)) {
            val ways = SettingsWays.forStep(step.id, m)
            assertTrue("${step.id}/$m has pages", ways.isNotEmpty())
            val ids = ways.map { it.id }
            assertEquals("no duplicates for ${step.id}/$m", ids.size, ids.toSet().size)
            assertEquals("last is Settings for ${step.id}/$m", SettingsWays.SETTINGS_HOME.id, ids.last())
            assertTrue("the app page is offered for ${step.id}/$m", SettingsWays.APP_INFO.id in ids)
        }
    }

    @Test fun theBatteryQuestionComesFirstForBatteryOptimisationSteps() {
        for (id in listOf("op_battery", "tr_batt", "gen_batt")) {
            assertEquals(SettingsWays.BATTERY_DIALOG.id, SettingsWays.forStep(id, "any").first().id)
        }
    }

    @Test fun samsungBatteryStepsTryTheDeviceCarePageFirst() {
        for (id in listOf("sa_never", "sa_unused")) {
            assertTrue(SettingsWays.forStep(id, "samsung").first().cls!!.contains("BatteryActivity"))
        }
    }

    @Test fun xiaomiSaverOpensPayTracesOwnChoiceAndPassesTheAppName() {
        val w = SettingsWays.forStep("xi_saver", "xiaomi").first()
        assertEquals("com.miui.powerkeeper", w.pkg)
        assertEquals("{pkg}", w.extras["package_name"])
        assertEquals("{label}", w.extras["package_label"])
    }

    @Test fun oneplusBackgroundStepStartsWithTheAppPageWhichEveryPhoneHas() {
        assertEquals(SettingsWays.APP_INFO.id, SettingsWays.forStep("op_bg", "oneplus").first().id)
    }

    @Test fun vendorPagesNameAPackageAndAClass() {
        for (m in makers) for (step in Setup.guide(m)) for (w in SettingsWays.forStep(step.id, m)) {
            if (w.pkg != null || w.cls != null) {
                assertTrue("${w.id}: package", w.pkg != null && w.pkg.contains('.'))
                assertTrue("${w.id}: class", w.cls != null && w.cls.contains('.'))
            } else {
                assertTrue("${w.id}: action", !w.action.isNullOrBlank())
            }
        }
    }

    @Test fun theGenericAutostartStepUsesTheBrandsOwnPagesWhenItHasThem() {
        val ways = SettingsWays.forStep("gen_auto", "vivo")
        assertTrue(ways.first().cls!!.contains("BgStartUpManagerActivity"))
        assertEquals(SettingsWays.APP_INFO.id, SettingsWays.forStep("gen_auto", "Google").first().id)
    }
}
