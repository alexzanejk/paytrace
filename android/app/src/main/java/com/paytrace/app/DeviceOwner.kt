package com.paytrace.app

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context

/** The receiver `adb shell dpm set-device-owner` points at.
 *
 *  It does nothing. It has to exist, and be named in the manifest with BIND_DEVICE_ADMIN, or the command fails with
 *  "Unknown admin" and we learn nothing about whether the phone's brand would have allowed it. Its policy file
 *  (`res/xml/device_admin.xml`) is empty on purpose, so being the device owner changes nothing by itself. */
class PayTraceAdmin : DeviceAdminReceiver()

/** Whether this phone has handed PayTrace the owner's seat, and how to give it back.
 *
 *  WHY this is wanted (none of it is built yet, and none of it happens until it is):
 *  silent app updates with nobody tapping Install, the SMS and phone permissions granted without asking, the app
 *  impossible to uninstall or switch off, and Android 13's "restricted settings" block on a sideloaded app gone,
 *  which is the thing that has to be undone by hand after every single update today.
 *
 *  WHAT IT CANNOT DO, and must never be sold as doing: MIUI's "Autostart" and "Display pop-up windows while running
 *  in the background", Funtouch's "high background power consumption", ColorOS's own rules. Those are the phone
 *  brand's inventions, not Android's, and no device policy reaches them. They stay hand-set, exactly as now.
 *
 *  THE WAY OUT MATTERS MOST. A device owner cannot be uninstalled and, on most phones, cannot be removed from
 *  Settings either — so without [release] the only way back is a factory reset, which on a payment phone means
 *  pairing again, wallet numbers again, the whole setup again. [release] is therefore in the SAME build as the
 *  receiver, never a later one. */
object DeviceOwner {
    fun component(ctx: Context): ComponentName = ComponentName(ctx.applicationContext, PayTraceAdmin::class.java)

    private fun dpm(ctx: Context): DevicePolicyManager? =
        try { ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager } catch (e: Exception) { null }

    /** True when PayTrace holds the owner's seat on this phone. */
    fun isOwner(ctx: Context): Boolean =
        try { dpm(ctx)?.isDeviceOwnerApp(ctx.packageName) == true } catch (e: Exception) { false }

    /** Android's own answer to "could this phone still be made a managed device?" — false once an account exists,
     *  once another app holds the seat, or on a phone that does not allow it. Asking beforehand saves removing the
     *  Mi account for nothing, which on a Xiaomi is not a free thing to try (see [XIAOMI_WARNING]).
     *
     *  Not a promise: a phone can answer yes here and its brand still refuse the command. That is the whole reason
     *  for running it on one phone and looking. */
    fun couldBeOwner(ctx: Context): Boolean? = try {
        @Suppress("DEPRECATION")
        dpm(ctx)?.isProvisioningAllowed(DevicePolicyManager.ACTION_PROVISION_MANAGED_DEVICE)
    } catch (e: Exception) {
        null
    }

    /** Hands the seat back and leaves PayTrace an ordinary app again. Returns true if the phone accepted it.
     *
     *  This is the undo for the whole experiment. It is why the command below may be run at all. */
    fun release(ctx: Context): Boolean = try {
        @Suppress("DEPRECATION")
        dpm(ctx)?.clearDeviceOwnerApp(ctx.packageName)
        !isOwner(ctx)
    } catch (e: Exception) {
        false
    }

    /** The one line to run from a computer over adb. Pure, so the exact spelling is unit tested: a typo here would
     *  look exactly like the phone refusing, and that is the question we are trying to answer. */
    fun adbCommand(packageName: String): String =
        "adb shell dpm set-device-owner " + packageName + "/" + PayTraceAdmin::class.java.name

    /** What a phone demands before it will accept that command. Said plainly because the FIRST attempt is on a
     *  Xiaomi, where the two requirements fight each other. */
    val requirements: List<String> = listOf(
        "No accounts at all in Settings → Accounts — Google, Mi, Samsung, email. Android refuses while even one is there.",
        "USB debugging on, and the phone connected (over a cable or wireless debugging).",
        "No second user and no work profile on the phone.",
    )

    /** The Xiaomi trap, in the app itself so whoever runs the command has it in front of them. */
    const val XIAOMI_WARNING =
        "On Xiaomi, Redmi and Poco the setting that lets adb grant permissions — Developer options → " +
            "\"USB debugging (Security settings)\" — needs a Mi account signed in, and switches itself off when that " +
            "account is removed. Removing the Mi account to satisfy Android may therefore take away the very adb " +
            "powers the command needs. If the command then fails you are left with no Mi account AND no privileged " +
            "adb: sign the Mi account back in to undo that. It is not known whether this command needs that setting."

    fun isXiaomi(maker: String, brand: String): Boolean =
        (maker + " " + brand).lowercase().let {
            it.contains("xiaomi") || it.contains("redmi") || it.contains("poco")
        }
}
